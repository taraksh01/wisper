use reqwest::blocking::Client;
use std::path::PathBuf;

pub trait SttProvider: Send + Sync {
    fn transcribe(&self, audio: &[f32], sample_rate: u32) -> Result<String, String>;
}

pub struct LocalWhisperProvider {
    model_path: PathBuf,
}

impl LocalWhisperProvider {
    pub fn new(model_path: PathBuf) -> Self {
        Self { model_path }
    }
}

impl SttProvider for LocalWhisperProvider {
    fn transcribe(&self, audio: &[f32], _sample_rate: u32) -> Result<String, String> {
        use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

        if !self.model_path.exists() {
            return Err(format!("Model file not found at: {:?}", self.model_path));
        }

        let ctx = WhisperContext::new_with_params(
            self.model_path.to_str().unwrap(),
            WhisperContextParameters::default(),
        )
        .map_err(|e| format!("Failed to load Whisper model: {}", e))?;

        let mut state = ctx
            .create_state()
            .map_err(|e| format!("Failed to create Whisper state: {}", e))?;

        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        params.set_language(Some("en"));
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);

        state
            .full(params, audio)
            .map_err(|e| format!("Transcription failed: {}", e))?;

        let num_segments = state.full_n_segments();

        let mut text = String::new();
        for i in 0..num_segments {
            if let Some(segment) = state.get_segment(i) {
                if let Ok(str_text) = segment.to_str() {
                    text.push_str(str_text);
                    text.push(' ');
                }
            }
        }

        Ok(text.trim().to_string())
    }
}

pub struct CloudSttProvider {
    base_url: String,
    api_key: String,
    model: String,
}

impl CloudSttProvider {
    pub fn new(base_url: String, api_key: String, model: String) -> Self {
        Self {
            base_url,
            api_key,
            model,
        }
    }
}

impl SttProvider for CloudSttProvider {
    fn transcribe(&self, audio: &[f32], sample_rate: u32) -> Result<String, String> {
        // Save audio to temporary WAV file
        let temp_dir = std::env::temp_dir();
        let wav_path = temp_dir.join("v3_dictate_temp.wav");
        
        crate::audio::save_wav(wav_path.to_str().unwrap(), audio, sample_rate)
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

        let endpoint = format!("{}/audio/transcriptions", self.base_url.trim_end_matches('/'));

        let resp = client
            .post(&endpoint)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .multipart(form)
            .send()
            .map_err(|e| format!("HTTP request failed: {}", e))?;

        if !resp.status().is_success() {
            return Err(format!("Cloud API error: {}", resp.text().unwrap_or_default()));
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

pub struct LocalParakeetProvider;

impl SttProvider for LocalParakeetProvider {
    fn transcribe(&self, _audio: &[f32], _sample_rate: u32) -> Result<String, String> {
        Err("Parakeet GGUF models are not yet supported. Please use a whisper model (.bin) from the Engine tab.".to_string())
    }
}

pub fn create_local_provider(model_path: PathBuf) -> Box<dyn SttProvider> {
    let path_str = model_path.to_string_lossy().to_lowercase();
    if path_str.ends_with(".gguf") {
        Box::new(LocalParakeetProvider)
    } else {
        Box::new(LocalWhisperProvider::new(model_path))
    }
}
