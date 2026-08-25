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
const MODEL_TTL: Duration = Duration::from_secs(60 * 60); // 1 hour

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
    let ratio = output_rate as f64 / input_rate as f64;
    let output_len = (input.len() as f64 * ratio) as usize;
    let mut output = Vec::with_capacity(output_len);
    for i in 0..output_len {
        let src_pos = i as f64 / ratio;
        let idx = src_pos as usize;
        let frac = (src_pos - idx as f64) as f32;
        let a = input[idx.min(input.len() - 1)];
        let b = input[(idx + 1).min(input.len() - 1)];
        // Linear interpolation reduces aliasing vs nearest-neighbour
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

pub fn create_local_engine(model_path: PathBuf) -> Box<dyn EngineProvider> {
    let name = model_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("");
    if name.starts_with("indicconformer-") {
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
