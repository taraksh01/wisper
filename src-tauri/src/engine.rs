use reqwest::blocking::Client;
use std::path::PathBuf;
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

        // Try to reuse cached model if same dir and within TTL
        let mut guard = parakeet_cache().lock().unwrap_or_else(|e| e.into_inner());
        let use_cached = guard
            .as_ref()
            .map(|c| c.dir == self.model_dir && c.last_used.elapsed() < MODEL_TTL)
            .unwrap_or(false);

        let text = if use_cached {
            let cached = guard.as_mut().unwrap();
            cached.last_used = Instant::now();
            // Spawn idle eviction check in background
            let dir_clone = cached.dir.clone();
            std::thread::spawn(move || {
                std::thread::sleep(MODEL_TTL);
                if let Ok(mut guard) = parakeet_cache().lock() {
                    if let Some(c) = guard.as_ref() {
                        if c.dir == dir_clone && c.last_used.elapsed() >= MODEL_TTL {
                            *guard = None;
                        }
                    }
                }
            });
            cached
                .model
                .transcribe_with(&samples, &ParakeetParams::default())
                .map_err(|e| format!("Parakeet transcription failed: {}", e))?
                .text
                .trim()
                .to_string()
        } else {
            // Drop old model before loading new (frees RAM)
            *guard = None;
            drop(guard);
            let mut model = ParakeetModel::load(&self.model_dir, &Quantization::Int8)
                .map_err(|e| format!("Failed to load Parakeet ONNX model: {}", e))?;
            let result = model
                .transcribe_with(&samples, &ParakeetParams::default())
                .map_err(|e| format!("Parakeet transcription failed: {}", e))?;
            let text = result.text.trim().to_string();
            // Cache for next call within TTL
            let mut guard = parakeet_cache().lock().unwrap_or_else(|e| e.into_inner());
            *guard = Some(CachedParakeet {
                dir: self.model_dir.clone(),
                model,
                last_used: Instant::now(),
            });
            let dir_clone = self.model_dir.clone();
            std::thread::spawn(move || {
                std::thread::sleep(MODEL_TTL);
                if let Ok(mut guard) = parakeet_cache().lock() {
                    if let Some(c) = guard.as_ref() {
                        if c.dir == dir_clone && c.last_used.elapsed() >= MODEL_TTL {
                            *guard = None;
                        }
                    }
                }
            });
            text
        };

        Ok(text)
    }
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
        let wav_path = temp_dir.join(format!("wisper_{}_{}.wav", std::process::id(), nanos));
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

        let client = Client::new();
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

        let _ = std::fs::remove_file(&wav_path);

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
                let cached = guard.as_mut().unwrap();
                cached.last_used = Instant::now();
                let dir = cached.dir.clone();
                drop(guard);
                schedule_indic_eviction(dir);

                let mut guard = indic_cache().lock().unwrap_or_else(|e| e.into_inner());
                let cached = guard.as_mut().unwrap();
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
        // Tokens: try tokens.txt, else generate from vocab.json
        let tokens_path = self.model_dir.join("tokens.txt");
        if !tokens_path.exists() {
            let vocab_path = self.model_dir.join("vocab.json");
            if vocab_path.exists() {
                let vocab_str = std::fs::read_to_string(&vocab_path).map_err(|e| e.to_string())?;
                let vocab: serde_json::Value =
                    serde_json::from_str(&vocab_str).map_err(|e| e.to_string())?;
                // vocab.json formats seen: bare array ["<unk>", ...] (index = id),
                // {"tokens": [...]}, or {token: id} map
                let tokens: Vec<String> = if let Some(arr) = vocab.as_array() {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(|s| s.to_string()))
                        .collect()
                } else if let Some(arr) = vocab.get("tokens").and_then(|v| v.as_array()) {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(|s| s.to_string()))
                        .collect()
                } else if let Some(obj) = vocab.as_object() {
                    // vocab is object with token->id
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
                // CTC blank is last id
                out.push_str("<blk>\n");
                std::fs::write(&tokens_path, out).map_err(|e| e.to_string())?;
            } else {
                return Err(format!(
                    "Missing tokens/vocab in {}",
                    self.model_dir.display()
                ));
            }
        }

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

struct UnsupportedProvider {
    msg: String,
}
impl EngineProvider for UnsupportedProvider {
    fn transcribe(&self, _audio: &[f32], _sample_rate: u32) -> Result<String, String> {
        Err(self.msg.clone())
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
        Box::new(UnsupportedProvider {
            msg: "Moonshine models need encoder+decoder+tokens (4 files). Use Parakeet or IndicConformer for now, or download the full Moonshine ONNX bundle manually.".into(),
        })
    } else {
        Box::new(ParakeetOnnxProvider::new(model_path))
    }
}
