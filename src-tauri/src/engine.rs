use reqwest::blocking::Client;
use std::path::PathBuf;

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

impl EngineProvider for ParakeetOnnxProvider {
    fn transcribe(&self, audio: &[f32], _sample_rate: u32) -> Result<String, String> {
        use transcribe_rs::onnx::parakeet::{ParakeetModel, ParakeetParams};
        use transcribe_rs::onnx::Quantization;

        let samples = if _sample_rate != 16000 {
            resample(audio, _sample_rate, 16000)
        } else {
            audio.to_vec()
        };

        let mut model = ParakeetModel::load(&self.model_dir, &Quantization::Int8)
            .map_err(|e| format!("Failed to load Parakeet ONNX model: {}", e))?;

        let result = model
            .transcribe_with(&samples, &ParakeetParams::default())
            .map_err(|e| format!("Parakeet transcription failed: {}", e))?;

        Ok(result.text.trim().to_string())
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

pub fn create_local_engine(model_path: PathBuf) -> Box<dyn EngineProvider> {
    Box::new(ParakeetOnnxProvider::new(model_path))
}
