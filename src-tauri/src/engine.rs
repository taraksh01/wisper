use reqwest::blocking::Client;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

pub trait EngineProvider: Send + Sync {
    fn transcribe(&self, audio: &[f32], sample_rate: u32) -> Result<String, String>;
}

pub struct ParakeetOnnxProvider {
    model_dir: PathBuf,
}

impl ParakeetOnnxProvider {
    pub fn new(model_dir: PathBuf) -> Self {
        Self { model_dir }
    }
}

struct CachedParakeet {
    dir: PathBuf,
    model: transcribe_rs::onnx::parakeet::ParakeetModel,
    last_used: Instant,
}

static PARAKEET_CACHE: OnceLock<Mutex<Option<CachedParakeet>>> = OnceLock::new();
const MODEL_TTL: Duration = Duration::from_secs(60 * 60 * 6); // 6 hours — keep resident for frequent dictation

fn parakeet_cache() -> &'static Mutex<Option<CachedParakeet>> {
    PARAKEET_CACHE.get_or_init(|| Mutex::new(None))
}

impl EngineProvider for ParakeetOnnxProvider {
    fn transcribe(&self, audio: &[f32], _sample_rate: u32) -> Result<String, String> {
        use transcribe_rs::onnx::parakeet::{ParakeetModel, ParakeetParams};
        use transcribe_rs::onnx::Quantization;

        let samples = if _sample_rate != 16000 {
            resample(audio, _sample_rate, 16000)
        } else {
            audio.to_vec()
        };

        // Take the model out of the cache for the duration of inference so the
        // lock is never held across the (seconds-long) transcribe call.
        let mut model = {
            let mut guard = parakeet_cache().lock().unwrap_or_else(|e| e.into_inner());
            match guard.as_mut() {
                Some(c) if c.dir == self.model_dir && c.last_used.elapsed() < MODEL_TTL => {
                    c.last_used = Instant::now();
                    guard.take().map(|c| c.model)
                }
                _ => {
                    // Drop stale/other model before loading new (frees RAM)
                    *guard = None;
                    None
                }
            }
        };

        if model.is_none() {
            model = Some(
                ParakeetModel::load(&self.model_dir, &Quantization::Int8)
                    .map_err(|e| format!("Failed to load Parakeet ONNX model: {}", e))?,
            );
        }

        let result = model
            .as_mut()
            .ok_or_else(|| "Parakeet model unexpectedly empty".to_string())?
            .transcribe_with(&samples, &ParakeetParams::default())
            .map_err(|e| format!("Parakeet transcription failed: {}", e))?;
        let text = result.text.trim().to_string();

        // Return the model to the cache for reuse within TTL
        {
            let mut guard = parakeet_cache().lock().unwrap_or_else(|e| e.into_inner());
            let model = model
                .take()
                .ok_or_else(|| "Parakeet model unexpectedly empty".to_string())?;
            *guard = Some(CachedParakeet {
                dir: self.model_dir.clone(),
                model,
                last_used: Instant::now(),
            });
        }
        schedule_parakeet_eviction(self.model_dir.clone());

        Ok(text)
    }
}

/// Spawn a background check that evicts the cached Parakeet model if idle past MODEL_TTL.
fn schedule_parakeet_eviction(dir: PathBuf) {
    std::thread::spawn(move || {
        std::thread::sleep(MODEL_TTL);
        if let Ok(mut guard) = parakeet_cache().lock() {
            // Only evict if still idle — a recent transcribe refreshes last_used
            if let Some(c) = guard.as_ref() {
                if c.dir == dir && c.last_used.elapsed() >= MODEL_TTL {
                    *guard = None;
                }
            }
        }
    });
}

pub fn resample(input: &[f32], input_rate: u32, output_rate: u32) -> Vec<f32> {
    if input_rate == output_rate {
        return input.to_vec();
    }
    if input.is_empty() {
        return Vec::new();
    }
    // Fast path for the common cpal case 48 kHz -> 16 kHz (exact 3:1)
    if input_rate == 48000 && output_rate == 16000 {
        let mut out = Vec::with_capacity(input.len() / 3);
        for chunk in input.chunks_exact(3) {
            // Simple box filter: average 3 samples for anti-aliasing
            out.push((chunk[0] + chunk[1] + chunk[2]) / 3.0);
        }
        let rem = input.len() % 3;
        if rem != 0 {
            let tail = &input[input.len() - rem..];
            out.push(tail.iter().sum::<f32>() / rem as f32);
        }
        return out;
    }
    let ratio = output_rate as f64 / input_rate as f64;
    let output_len = (input.len() as f64 * ratio) as usize;
    let mut output = Vec::with_capacity(output_len);
    for i in 0..output_len {
        let src_pos = i as f64 / ratio;
        let idx = src_pos as usize;
        let frac = (src_pos - idx as f64) as f32;
        let a = input[idx.min(input.len() - 1)];
        let b = input[(idx + 1).min(input.len() - 1)];
        output.push(a * (1.0 - frac) + b * frac);
    }
    output
}

static CLOUD_CLIENT: OnceLock<Client> = OnceLock::new();
static CLOUD_TMP_CTR: AtomicU64 = AtomicU64::new(0);

fn cloud_client() -> &'static Client {
    CLOUD_CLIENT.get_or_init(|| {
        Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(60))
            .build()
            .unwrap_or_else(|e| {
                eprintln!(
                    "[engine] failed to build cloud client: {} — using default",
                    e
                );
                Client::new()
            })
    })
}

pub struct CloudEngineProvider {
    base_url: String,
    api_key: String,
    model: String,
}

impl CloudEngineProvider {
    pub fn new(base_url: String, api_key: String, model: String) -> Self {
        Self {
            base_url,
            api_key,
            model,
        }
    }
}

impl EngineProvider for CloudEngineProvider {
    fn transcribe(&self, audio: &[f32], sample_rate: u32) -> Result<String, String> {
        let temp_dir = std::env::temp_dir();
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let ctr = CLOUD_TMP_CTR.fetch_add(1, Ordering::Relaxed);
        let wav_path = temp_dir.join(format!(
            "wisper_{}_{}_{}.wav",
            std::process::id(),
            nanos,
            ctr
        ));
        // Ensure unique file with 0600 permissions and cleanup on scope exit
        struct Guard(std::path::PathBuf);
        impl Drop for Guard {
            fn drop(&mut self) {
                let _ = std::fs::remove_file(&self.0);
            }
        }
        let _guard = Guard(wav_path.clone());

        crate::audio::save_wav(&wav_path, audio, sample_rate)
            .map_err(|e| format!("Failed to save temporary wav: {}", e))?;

        let file_bytes = std::fs::read(&wav_path)
            .map_err(|e| format!("Failed to read temporary wav file: {}", e))?;

        let client = cloud_client();
        let part = reqwest::blocking::multipart::Part::bytes(file_bytes)
            .file_name("audio.wav")
            .mime_str("audio/wav")
            .map_err(|e| format!("Failed to construct multipart: {}", e))?;

        let form = reqwest::blocking::multipart::Form::new()
            .text("model", self.model.clone())
            .part("file", part);

        let endpoint = format!(
            "{}/audio/transcriptions",
            self.base_url.trim_end_matches('/')
        );

        let resp = client
            .post(&endpoint)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .multipart(form)
            .send()
            .map_err(|e| format!("HTTP request failed: {}", e))?;

        if !resp.status().is_success() {
            return Err(format!(
                "Cloud API error: {}",
                resp.text().unwrap_or_default()
            ));
        }

        let json: serde_json::Value = resp
            .json()
            .map_err(|e| format!("Failed to parse response JSON: {}", e))?;

        let text = json["text"]
            .as_str()
            .ok_or("No 'text' field in JSON response")?;

        Ok(text.to_string())
    }
}

pub struct SherpaIndicProvider {
    model_dir: PathBuf,
}

impl SherpaIndicProvider {
    pub fn new(model_dir: PathBuf) -> Self {
        Self { model_dir }
    }
}

struct CachedIndic {
    dir: PathBuf,
    recognizer: sherpa_onnx::OfflineRecognizer,
    last_used: Instant,
}

static INDIC_CACHE: OnceLock<Mutex<Option<CachedIndic>>> = OnceLock::new();

fn indic_cache() -> &'static Mutex<Option<CachedIndic>> {
    INDIC_CACHE.get_or_init(|| Mutex::new(None))
}

/// Spawn a background check that evicts the cached model if idle past MODEL_TTL.
fn schedule_indic_eviction(dir: PathBuf) {
    std::thread::spawn(move || {
        std::thread::sleep(MODEL_TTL);
        if let Ok(mut guard) = indic_cache().lock() {
            if let Some(c) = guard.as_ref() {
                if c.dir == dir && c.last_used.elapsed() >= MODEL_TTL {
                    *guard = None;
                }
            }
        }
    });
}

fn ensure_tokens_txt(model_dir: &Path) -> Result<PathBuf, String> {
    let tokens_path = model_dir.join("tokens.txt");
    if tokens_path.exists() {
        return Ok(tokens_path);
    }
    let vocab_path = model_dir.join("vocab.json");
    if !vocab_path.exists() {
        return Err(format!("Missing tokens/vocab in {}", model_dir.display()));
    }
    let vocab_str = std::fs::read_to_string(&vocab_path).map_err(|e| e.to_string())?;
    let vocab: serde_json::Value = serde_json::from_str(&vocab_str).map_err(|e| e.to_string())?;
    let tokens: Vec<String> = if let Some(arr) = vocab.as_array() {
        arr.iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect()
    } else if let Some(arr) = vocab.get("tokens").and_then(|v| v.as_array()) {
        arr.iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect()
    } else if let Some(obj) = vocab.as_object() {
        let mut pairs: Vec<_> = obj.iter().collect();
        pairs.sort_by_key(|(_, id)| id.as_u64().unwrap_or(0));
        pairs.into_iter().map(|(k, _)| k.clone()).collect()
    } else {
        return Err("Unknown vocab.json format".into());
    };
    let mut out = String::new();
    for tok in tokens {
        out.push_str(&tok);
        out.push('\n');
    }
    out.push_str("<blk>\n");
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        let mut opts = std::fs::OpenOptions::new();
        opts.write(true).create(true).truncate(true).mode(0o600);
        let mut f = opts.open(&tokens_path).map_err(|e| e.to_string())?;
        use std::io::Write;
        f.write_all(out.as_bytes()).map_err(|e| e.to_string())?;
        f.sync_all().map_err(|e| e.to_string())?;
    }
    #[cfg(not(unix))]
    {
        std::fs::write(&tokens_path, out).map_err(|e| e.to_string())?;
    }
    Ok(tokens_path)
}

impl EngineProvider for SherpaIndicProvider {
    fn transcribe(&self, audio: &[f32], sample_rate: u32) -> Result<String, String> {
        use sherpa_onnx::{OfflineNemoEncDecCtcModelConfig, OfflineRecognizerConfig};

        let samples = if sample_rate != 16000 {
            resample(audio, sample_rate, 16000)
        } else {
            audio.to_vec()
        };

        // Reuse cached recognizer if same dir and within TTL
        {
            let mut guard = indic_cache().lock().unwrap_or_else(|e| e.into_inner());
            let reuse = guard
                .as_ref()
                .map(|c| c.dir == self.model_dir && c.last_used.elapsed() < MODEL_TTL)
                .unwrap_or(false);
            if reuse {
                let cached = match guard.as_mut() {
                    Some(c) => c,
                    None => return Err("Indic cache unexpectedly empty".into()),
                };
                cached.last_used = Instant::now();
                let dir = cached.dir.clone();
                drop(guard);
                schedule_indic_eviction(dir);

                let mut guard = indic_cache().lock().unwrap_or_else(|e| e.into_inner());
                let cached = match guard.as_mut() {
                    Some(c) => c,
                    None => return Err("Indic cache unexpectedly empty".into()),
                };
                let stream = cached.recognizer.create_stream();
                stream.accept_waveform(16000, &samples);
                cached.recognizer.decode(&stream);
                let result = stream
                    .get_result()
                    .ok_or_else(|| "Indic decode: no result".to_string())?;
                return Ok(result.text.trim().to_string());
            }
        }

        // Build fresh recognizer (drops old cached one first to free RAM)
        {
            let mut guard = indic_cache().lock().unwrap_or_else(|e| e.into_inner());
            *guard = None;
        }

        let model_path = self.model_dir.join("model.onnx");
        if !model_path.exists() {
            return Err(format!("Indic model missing: {}", model_path.display()));
        }
        let tokens_path = ensure_tokens_txt(&self.model_dir)?;

        let mut config = OfflineRecognizerConfig::default();
        config.model_config.nemo_ctc = OfflineNemoEncDecCtcModelConfig {
            model: Some(model_path.to_string_lossy().to_string()),
        };
        config.model_config.tokens = Some(tokens_path.to_string_lossy().to_string());
        config.model_config.num_threads = 2;
        config.model_config.debug = false;

        let recognizer = sherpa_onnx::OfflineRecognizer::create(&config).ok_or_else(|| {
            format!(
                "Failed to create Indic recognizer for {}",
                self.model_dir.display()
            )
        })?;

        let stream = recognizer.create_stream();
        stream.accept_waveform(16000, &samples);
        recognizer.decode(&stream);
        let result = stream
            .get_result()
            .ok_or_else(|| "Indic decode: no result".to_string())?;
        let text = result.text.trim().to_string();

        // Cache for next call within TTL
        {
            let mut guard = indic_cache().lock().unwrap_or_else(|e| e.into_inner());
            *guard = Some(CachedIndic {
                dir: self.model_dir.clone(),
                recognizer,
                last_used: Instant::now(),
            });
        }
        schedule_indic_eviction(self.model_dir.clone());

        Ok(text)
    }
}

pub struct WhisperLargeV3Provider {
    model_dir: PathBuf,
}

impl WhisperLargeV3Provider {
    pub fn new(model_dir: PathBuf) -> Self {
        Self { model_dir }
    }

    fn transcribe_with_hint(&self, samples: &[f32], hint: &str) -> Result<String, String> {
        use sherpa_onnx::{OfflineRecognizerConfig, OfflineWhisperModelConfig};
        let encoder = self.model_dir.join("large-v3-encoder.int8.onnx");
        let decoder = self.model_dir.join("large-v3-decoder.int8.onnx");
        let tokens = self.model_dir.join("large-v3-tokens.txt");
        if !encoder.exists() || !decoder.exists() || !tokens.exists() {
            return Err(format!(
                "Whisper large-v3 files missing in {}",
                self.model_dir.display()
            ));
        }
        let mut config = OfflineRecognizerConfig::default();
        config.model_config.whisper = OfflineWhisperModelConfig {
            encoder: Some(encoder.to_string_lossy().to_string()),
            decoder: Some(decoder.to_string_lossy().to_string()),
            language: Some(hint.to_string()),
            task: Some("transcribe".to_string()),
            tail_paddings: -1,
            enable_token_timestamps: false,
            enable_segment_timestamps: false,
        };
        config.model_config.model_type = Some("whisper".to_string());
        config.model_config.tokens = Some(tokens.to_string_lossy().to_string());
        config.model_config.num_threads = 2;
        config.model_config.debug = false;
        config.model_config.provider = Some("cpu".to_string());
        let recognizer = sherpa_onnx::OfflineRecognizer::create(&config).ok_or_else(|| {
            format!(
                "Failed to create Whisper v3 recognizer for {}",
                self.model_dir.display()
            )
        })?;
        let stream = recognizer.create_stream();
        stream.accept_waveform(16000, samples);
        recognizer.decode(&stream);
        let result = stream
            .get_result()
            .ok_or_else(|| "Whisper v3 decode: no result".to_string())?;
        Ok(result.text.trim().to_string())
    }
}

struct CachedWhisperV3 {
    dir: PathBuf,
    recognizer: sherpa_onnx::OfflineRecognizer,
    last_used: Instant,
}

static WHISPER_V3_CACHE: OnceLock<Mutex<Option<CachedWhisperV3>>> = OnceLock::new();

fn whisper_v3_cache() -> &'static Mutex<Option<CachedWhisperV3>> {
    WHISPER_V3_CACHE.get_or_init(|| Mutex::new(None))
}

fn schedule_whisper_v3_eviction(dir: PathBuf) {
    std::thread::spawn(move || {
        std::thread::sleep(MODEL_TTL);
        if let Ok(mut guard) = whisper_v3_cache().lock() {
            if let Some(c) = guard.as_ref() {
                if c.dir == dir && c.last_used.elapsed() >= MODEL_TTL {
                    *guard = None;
                }
            }
        }
    });
}

impl EngineProvider for WhisperLargeV3Provider {
    fn transcribe(&self, audio: &[f32], sample_rate: u32) -> Result<String, String> {
        use sherpa_onnx::{OfflineRecognizerConfig, OfflineWhisperModelConfig};

        let samples = if sample_rate != 16000 {
            resample(audio, sample_rate, 16000)
        } else {
            audio.to_vec()
        };

        let enabled_check = crate::coordinator::ENABLED_LANGUAGES
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        if enabled_check.len() > 1 && !enabled_check.contains(&"auto".to_string()) {
            for lang in &enabled_check {
                match self.transcribe_with_hint(&samples, lang) {
                    Ok(t) if !t.trim().is_empty() => return Ok(t),
                    Ok(_) => continue,
                    Err(e) => {
                        eprintln!("[whisper] hint {} failed: {}", lang, e);
                        continue;
                    }
                }
            }
            return self.transcribe_with_hint(&samples, "");
        }

        let recognizer = {
            let mut guard = whisper_v3_cache().lock().unwrap_or_else(|e| e.into_inner());
            let reuse = guard
                .as_ref()
                .map(|c| c.dir == self.model_dir && c.last_used.elapsed() < MODEL_TTL)
                .unwrap_or(false);
            if reuse {
                if let Some(c) = guard.as_mut() {
                    c.last_used = Instant::now();
                }
                let dir = guard.as_ref().map(|c| c.dir.clone());
                drop(guard);
                if let Some(d) = dir {
                    schedule_whisper_v3_eviction(d);
                }
                let mut guard = whisper_v3_cache().lock().unwrap_or_else(|e| e.into_inner());
                match guard.take() {
                    Some(c) => c.recognizer,
                    None => return Err("Whisper v3 cache unexpectedly empty".into()),
                }
            } else {
                drop(guard);
                // Drop stale/other model before loading new (frees RAM)
                {
                    let mut guard = whisper_v3_cache().lock().unwrap_or_else(|e| e.into_inner());
                    *guard = None;
                }
                let encoder = self.model_dir.join("large-v3-encoder.int8.onnx");
                let decoder = self.model_dir.join("large-v3-decoder.int8.onnx");
                let tokens = self.model_dir.join("large-v3-tokens.txt");
                if !encoder.exists() || !decoder.exists() || !tokens.exists() {
                    return Err(format!(
                        "Whisper large-v3 files missing in {}",
                        self.model_dir.display()
                    ));
                }
                let enabled = crate::coordinator::ENABLED_LANGUAGES
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .clone();
                let whisper_lang = if enabled.is_empty() || enabled.contains(&"auto".to_string()) {
                    String::new()
                } else if enabled.len() == 1 {
                    enabled[0].clone()
                } else {
                    String::new()
                };
                let mut config = OfflineRecognizerConfig::default();
                config.model_config.whisper = OfflineWhisperModelConfig {
                    encoder: Some(encoder.to_string_lossy().to_string()),
                    decoder: Some(decoder.to_string_lossy().to_string()),
                    language: Some(whisper_lang),
                    task: Some("transcribe".to_string()),
                    tail_paddings: -1,
                    enable_token_timestamps: false,
                    enable_segment_timestamps: false,
                };
                config.model_config.model_type = Some("whisper".to_string());
                config.model_config.tokens = Some(tokens.to_string_lossy().to_string());
                config.model_config.num_threads = 2;
                config.model_config.debug = false;
                config.model_config.provider = Some("cpu".to_string());

                let recognizer =
                    sherpa_onnx::OfflineRecognizer::create(&config).ok_or_else(|| {
                        format!(
                            "Failed to create Whisper v3 recognizer for {}",
                            self.model_dir.display()
                        )
                    })?;
                recognizer
            }
        };

        let stream = recognizer.create_stream();
        stream.accept_waveform(16000, &samples);
        recognizer.decode(&stream);
        let result = stream
            .get_result()
            .ok_or_else(|| "Whisper v3 decode: no result".to_string())?;
        let text = result.text.trim().to_string();

        // Return the recognizer to the cache
        {
            let mut guard = whisper_v3_cache().lock().unwrap_or_else(|e| e.into_inner());
            *guard = Some(CachedWhisperV3 {
                dir: self.model_dir.clone(),
                recognizer,
                last_used: Instant::now(),
            });
        }
        schedule_whisper_v3_eviction(self.model_dir.clone());

        Ok(text)
    }
}

pub struct IndicConformer600MProvider {
    model_dir: PathBuf,
}

impl IndicConformer600MProvider {
    pub fn new(model_dir: PathBuf) -> Self {
        Self { model_dir }
    }
}

struct Indic600MSession {
    preproc: ort::session::Session,
    encoder: ort::session::Session,
    decoder: ort::session::Session,
    vocab: Vec<String>,
    spans: std::collections::HashMap<String, (usize, usize)>,
}

impl IndicConformer600MProvider {
    fn load_session(&self) -> Result<Indic600MSession, String> {
        let model_path = self.model_dir.join("encoder-model.onnx");
        let decoder_path = self.model_dir.join("ctc_decoder-model.onnx");
        let preproc_path = self.model_dir.join("nemo128.onnx");
        let vocab_path = self.model_dir.join("vocab.txt");
        let spans_path = self.model_dir.join("language_spans.json");
        if !model_path.exists()
            || !decoder_path.exists()
            || !preproc_path.exists()
            || !vocab_path.exists()
            || !spans_path.exists()
        {
            return Err(format!(
                "IndicConformer 600M files missing in {} (need encoder-model.onnx, encoder-model.onnx.data, ctc_decoder-model.onnx, nemo128.onnx, vocab.txt, language_spans.json)",
                self.model_dir.display()
            ));
        }

        let vocab = std::fs::read_to_string(&vocab_path)
            .map_err(|e| format!("Failed to read vocab.txt: {}", e))?
            .lines()
            .map(|s| s.to_string())
            .collect::<Vec<_>>();
        if vocab.is_empty() {
            return Err("vocab.txt is empty".into());
        }
        let spans_str = std::fs::read_to_string(&spans_path)
            .map_err(|e| format!("Failed to read language_spans.json: {}", e))?;
        let spans = parse_language_spans(&spans_str)?;

        let preproc = build_ort_session(&preproc_path)?;
        let encoder = build_ort_session(&model_path)?;
        let decoder = build_ort_session(&decoder_path)?;

        Ok(Indic600MSession {
            preproc,
            encoder,
            decoder,
            vocab,
            spans,
        })
    }
}

impl EngineProvider for IndicConformer600MProvider {
    fn transcribe(&self, audio: &[f32], sample_rate: u32) -> Result<String, String> {
        let samples = if sample_rate != 16000 {
            resample(audio, sample_rate, 16000)
        } else {
            audio.to_vec()
        };

        let enabled = crate::coordinator::ENABLED_LANGUAGES
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        let languages: Vec<String> = if enabled.is_empty() || enabled.contains(&"auto".to_string())
        {
            Vec::new()
        } else {
            enabled
        };

        let mut sess = self.load_session()?;
        let text = decode_indic_600m_multi(&mut sess, &samples, &languages)?;
        Ok(text)
    }
}

fn build_ort_session(path: &Path) -> Result<ort::session::Session, String> {
    let mut builder = ort::session::Session::builder()
        .map_err(|e| format!("Failed to build ORT session: {}", e))?;
    builder = builder
        .with_intra_threads(2)
        .map_err(|e| format!("Failed to set threads: {}", e))?;
    builder
        .commit_from_file(path)
        .map_err(|e| format!("Failed to load ORT session from {}: {}", path.display(), e))
}

fn parse_language_spans(
    json_str: &str,
) -> Result<std::collections::HashMap<String, (usize, usize)>, String> {
    let v: serde_json::Value =
        serde_json::from_str(json_str).map_err(|e| format!("Invalid JSON: {}", e))?;
    let mut out = std::collections::HashMap::new();
    if let Some(obj) = v.as_object() {
        for (k, val) in obj {
            if let Some(arr) = val.as_array() {
                if arr.len() == 2 {
                    let start = arr[0].as_u64().unwrap_or(0) as usize;
                    let length = arr[1].as_u64().unwrap_or(0) as usize;
                    out.insert(k.clone(), (start, length));
                }
            }
        }
    }
    Ok(out)
}

fn decode_indic_600m_multi(
    sess: &mut Indic600MSession,
    samples: &[f32],
    languages: &[String],
) -> Result<String, String> {
    use ndarray::{Array1, Array2};
    use ort::value::TensorRef;

    let waveforms = Array2::from_shape_vec((1, samples.len()), samples.to_vec())
        .map_err(|e| format!("waveform shape: {}", e))?
        .into_dyn();
    let waveforms_lens = Array1::from_vec(vec![samples.len() as i64]).into_dyn();
    let t_waveforms = TensorRef::from_array_view(waveforms.view())
        .map_err(|e| format!("waveform tensor: {}", e))?;
    let t_waveforms_lens = TensorRef::from_array_view(waveforms_lens.view())
        .map_err(|e| format!("lens tensor: {}", e))?;
    let preproc_out = sess
        .preproc
        .run(ort::inputs![
            "waveforms" => t_waveforms,
            "waveforms_lens" => t_waveforms_lens
        ])
        .map_err(|e| format!("preprocessor run: {}", e))?;
    let features = preproc_out
        .get("features")
        .ok_or_else(|| "preprocessor: missing features output".to_string())?
        .try_extract_array::<f32>()
        .map_err(|e| format!("features extract: {}", e))?
        .to_owned();
    let features_lens = preproc_out
        .get("features_lens")
        .ok_or_else(|| "preprocessor: missing features_lens output".to_string())?
        .try_extract_array::<i64>()
        .map_err(|e| format!("features_lens extract: {}", e))?
        .to_owned();
    let features_lens_vec: Vec<i64> = features_lens.iter().copied().collect();

    let t_features = TensorRef::from_array_view(features.view())
        .map_err(|e| format!("features tensor: {}", e))?;
    let t_features_lens = TensorRef::from_array_view(features_lens.view())
        .map_err(|e| format!("features_lens tensor: {}", e))?;
    let encoder_out = sess
        .encoder
        .run(ort::inputs![
            "audio_signal" => t_features,
            "length" => t_features_lens
        ])
        .map_err(|e| format!("encoder run: {}", e))?;
    let encoded = encoder_out
        .get("outputs")
        .or_else(|| encoder_out.get("encoded"))
        .ok_or_else(|| "encoder: missing encoded output".to_string())?
        .try_extract_array::<f32>()
        .map_err(|e| format!("encoded extract: {}", e))?
        .to_owned();
    let encoded_lens_vec: Vec<i64> = encoder_out
        .get("encoded_lengths")
        .or_else(|| encoder_out.get("encoded_lens"))
        .and_then(|v| v.try_extract_array::<i64>().ok())
        .map(|a| a.iter().copied().collect())
        .unwrap_or_else(|| features_lens_vec.iter().map(|l| (l / 8).max(1)).collect());
    let t_encoded =
        TensorRef::from_array_view(encoded.view()).map_err(|e| format!("encoded tensor: {}", e))?;
    let decoder_out = sess
        .decoder
        .run(ort::inputs![
            "encoder_outputs" => t_encoded
        ])
        .map_err(|e| format!("decoder run: {}", e))?;
    let logits_arr = decoder_out
        .iter()
        .next()
        .ok_or_else(|| "decoder: missing logits output".to_string())?
        .1
        .try_extract_array::<f32>()
        .map_err(|e| format!("logits extract: {}", e))?
        .to_owned();
    let _logits_shape = logits_arr.shape().to_vec();
    let logits: Vec<f32> = logits_arr.iter().copied().collect();
    // The decoder output is (B, T, V) where V is 5633 (or 5632 in the
    // exported head). We need the actual shape; if it's (B, V, T) we'll
    // transpose in the greedy loop using T from the cached encoded_lens.
    let _ = encoded_lens_vec;

    // Determine vocab dimension from logits length and time frames.
    // The decoder emits a flat array of f32; we treat it as [B, T, V] and
    // infer V = logits.len() / total_T, where total_T = logits.len() / V.
    // If the head is [B, V, T] we approximate the same loop with a transpose.
    let total = logits.len();
    // Try assuming [B=1, T, V] layout first
    let vocab_dim = sess.vocab.len() + 1; // 5632 + 1 (blank at id 5632)
    let t = if total % vocab_dim == 0 {
        total / vocab_dim
    } else {
        0
    };
    let layout_ntv = t > 0;
    let (t_frames, vocab_dim) = if layout_ntv {
        (t, vocab_dim)
    } else {
        // Try [B, V, T] layout
        let vt = total / vocab_dim;
        (vt, vocab_dim)
    };

    let allowed_spans: Vec<(usize, usize)> = if languages.is_empty() {
        Vec::new()
    } else {
        languages
            .iter()
            .filter_map(|lang| sess.spans.get(lang.as_str()).copied())
            .collect()
    };
    let single_span = if allowed_spans.len() == 1 {
        Some(allowed_spans[0])
    } else {
        None
    };
    let is_multi = allowed_spans.len() > 1;
    let blank_id: i32 = (sess.vocab.len()) as i32;

    let mut out_ids: Vec<i32> = Vec::with_capacity(t_frames);
    let mut prev: i32 = -1;

    if layout_ntv {
        for frame in 0..t_frames {
            let row = &logits[frame * vocab_dim..(frame + 1) * vocab_dim];
            let mut best_idx: i32 = -1;
            let mut best_val: f32 = f32::NEG_INFINITY;
            if let Some((start, length)) = single_span {
                let end = (start + length).min(vocab_dim);
                for (i, slot) in row.iter().enumerate().take(end).skip(start) {
                    if *slot > best_val {
                        best_val = *slot;
                        best_idx = i as i32;
                    }
                }
            } else if is_multi {
                for (i, slot) in row.iter().enumerate() {
                    if i as i32 == blank_id {
                        continue;
                    }
                    let mut bias = f32::NEG_INFINITY;
                    let mut found = false;
                    for (prio, (s, l)) in allowed_spans.iter().enumerate() {
                        if i >= *s && i < *s + *l {
                            bias = match prio {
                                0 => 2.0,
                                1 => 1.0,
                                2 => 0.5,
                                3 => 0.25,
                                _ => 0.0,
                            };
                            found = true;
                            break;
                        }
                    }
                    if !found {
                        continue;
                    }
                    let score = *slot + bias;
                    if score > best_val {
                        best_val = score;
                        best_idx = i as i32;
                    }
                }
            } else {
                for (i, slot) in row.iter().enumerate() {
                    if i as i32 == blank_id {
                        continue;
                    }
                    if *slot > best_val {
                        best_val = *slot;
                        best_idx = i as i32;
                    }
                }
            }
            if best_idx >= 0 && best_idx != prev && best_idx != blank_id {
                out_ids.push(best_idx);
            }
            prev = best_idx;
        }
    } else {
        for frame in 0..t_frames {
            let mut best_idx: i32 = -1;
            let mut best_val: f32 = f32::NEG_INFINITY;
            if let Some((start, length)) = single_span {
                let end = (start + length).min(vocab_dim);
                for v in start..end {
                    let slot = logits[v * t_frames + frame];
                    if slot > best_val {
                        best_val = slot;
                        best_idx = v as i32;
                    }
                }
            } else if is_multi {
                for v in 0..vocab_dim {
                    if v as i32 == blank_id {
                        continue;
                    }
                    let mut bias = f32::NEG_INFINITY;
                    let mut found = false;
                    for (prio, (s, l)) in allowed_spans.iter().enumerate() {
                        if v >= *s && v < *s + *l {
                            bias = match prio {
                                0 => 2.0,
                                1 => 1.0,
                                2 => 0.5,
                                3 => 0.25,
                                _ => 0.0,
                            };
                            found = true;
                            break;
                        }
                    }
                    if !found {
                        continue;
                    }
                    let slot = logits[v * t_frames + frame];
                    let score = slot + bias;
                    if score > best_val {
                        best_val = score;
                        best_idx = v as i32;
                    }
                }
            } else {
                for v in 0..vocab_dim {
                    if v as i32 == blank_id {
                        continue;
                    }
                    let slot = logits[v * t_frames + frame];
                    if slot > best_val {
                        best_val = slot;
                        best_idx = v as i32;
                    }
                }
            }
            if best_idx >= 0 && best_idx != prev && best_idx != blank_id {
                out_ids.push(best_idx);
            }
            prev = best_idx;
        }
    }

    let mut text = String::new();
    for id in &out_ids {
        if let Some(tok) = sess.vocab.get(*id as usize) {
            let clean = tok.replace('\u{2581}', " ");
            text.push_str(&clean);
        }
    }
    Ok(text.trim().to_string())
}

#[allow(dead_code)]
fn decode_indic_600m(
    sess: &mut Indic600MSession,
    samples: &[f32],
    language: &str,
) -> Result<String, String> {
    let languages = if language.is_empty() || language == "auto" {
        Vec::new()
    } else {
        vec![language.to_string()]
    };
    decode_indic_600m_multi(sess, samples, &languages)
}

pub fn create_local_engine(model_path: PathBuf) -> Box<dyn EngineProvider> {
    let name = model_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("");
    if name.starts_with("indicconformer-600m-multi") {
        Box::new(IndicConformer600MProvider::new(model_path))
    } else if name.starts_with("whisper-large-v3") {
        Box::new(WhisperLargeV3Provider::new(model_path))
    } else if name.starts_with("indicconformer-") {
        Box::new(SherpaIndicProvider::new(model_path))
    } else if name.starts_with("moonshine-") {
        Box::new(MoonshineProvider::new(model_path))
    } else {
        Box::new(ParakeetOnnxProvider::new(model_path))
    }
}

pub struct MoonshineProvider {
    model_dir: PathBuf,
}

impl MoonshineProvider {
    pub fn new(model_dir: PathBuf) -> Self {
        Self { model_dir }
    }

    fn variant(&self) -> Option<transcribe_rs::onnx::moonshine::MoonshineVariant> {
        use transcribe_rs::onnx::moonshine::MoonshineVariant;
        let name = self
            .model_dir
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("");
        match name {
            "moonshine-base" => Some(MoonshineVariant::Base),
            _ => None,
        }
    }
}

struct CachedMoonshine {
    dir: PathBuf,
    model: transcribe_rs::onnx::moonshine::MoonshineModel,
    last_used: Instant,
}

static MOONSHINE_CACHE: OnceLock<Mutex<Option<CachedMoonshine>>> = OnceLock::new();

fn moonshine_cache() -> &'static Mutex<Option<CachedMoonshine>> {
    MOONSHINE_CACHE.get_or_init(|| Mutex::new(None))
}

fn schedule_moonshine_eviction(dir: PathBuf) {
    std::thread::spawn(move || {
        std::thread::sleep(MODEL_TTL);
        if let Ok(mut guard) = moonshine_cache().lock() {
            if let Some(c) = guard.as_ref() {
                if c.dir == dir && c.last_used.elapsed() >= MODEL_TTL {
                    *guard = None;
                }
            }
        }
    });
}

impl EngineProvider for MoonshineProvider {
    fn transcribe(&self, audio: &[f32], sample_rate: u32) -> Result<String, String> {
        use transcribe_rs::onnx::moonshine::{MoonshineModel, MoonshineParams};
        use transcribe_rs::onnx::Quantization;

        let variant = self
            .variant()
            .ok_or_else(|| format!("Unknown Moonshine variant for {}", self.model_dir.display()))?;

        let samples = if sample_rate != 16000 {
            resample(audio, sample_rate, 16000)
        } else {
            audio.to_vec()
        };

        // Take model out of cache so lock is never held across inference
        let mut model = {
            let mut guard = moonshine_cache().lock().unwrap_or_else(|e| e.into_inner());
            match guard.as_mut() {
                Some(c) if c.dir == self.model_dir && c.last_used.elapsed() < MODEL_TTL => {
                    c.last_used = Instant::now();
                    guard.take().map(|c| c.model)
                }
                _ => {
                    *guard = None;
                    None
                }
            }
        };

        if model.is_none() {
            model = Some(
                MoonshineModel::load(&self.model_dir, variant, &Quantization::FP32)
                    .map_err(|e| format!("Failed to load Moonshine ONNX model: {}", e))?,
            );
        }

        let result = model
            .as_mut()
            .ok_or_else(|| "Moonshine model unexpectedly empty".to_string())?
            .transcribe_with(&samples, &MoonshineParams::default())
            .map_err(|e| format!("Moonshine transcription failed: {}", e))?;
        let text = result.text.trim().to_string();

        // Return the model to the cache
        {
            let mut guard = moonshine_cache().lock().unwrap_or_else(|e| e.into_inner());
            let model = model
                .take()
                .ok_or_else(|| "Moonshine model unexpectedly empty".to_string())?;
            *guard = Some(CachedMoonshine {
                dir: self.model_dir.clone(),
                model,
                last_used: Instant::now(),
            });
        }
        schedule_moonshine_eviction(self.model_dir.clone());

        Ok(text)
    }
}
