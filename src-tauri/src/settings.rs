use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub stt_mode: String,
    pub stt_base_url: String,
    pub stt_api_key: String,
    pub stt_model: String,
    pub local_model_file: String,
    pub llm_enabled: bool,
    pub llm_base_url: String,
    pub llm_api_key: String,
    pub llm_model: String,
    pub llm_agent_name: String,
    pub hotkey: String,
    pub hotkey_mode: String,
    pub paste_method: String,
    pub vad_enabled: bool,
    pub vad_threshold: f32,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            stt_mode: "local".into(),
            stt_base_url: String::new(),
            stt_api_key: String::new(),
            stt_model: "whisper-1".into(),
            local_model_file: "ggml-base.en.bin".into(),
            llm_enabled: true,
            llm_base_url: "http://localhost:11434/v1".into(),
            llm_api_key: String::new(),
            llm_model: "llama3.2".into(),
            llm_agent_name: "Auto-Format".into(),
            hotkey: "F12".into(),
            hotkey_mode: "push-to-talk".into(),
            paste_method: "Ctrl+V".into(),
            vad_enabled: true,
            vad_threshold: 0.01,
        }
    }
}

impl AppSettings {
    fn path() -> PathBuf {
        let mut p = dirs::config_local_dir().unwrap_or_else(|| PathBuf::from("."));
        p.push("v3");
        let _ = fs::create_dir_all(&p);
        p.push("settings.json");
        p
    }

    pub fn load() -> Self {
        let p = Self::path();
        if p.exists() {
            if let Ok(content) = fs::read_to_string(&p) {
                if let Ok(s) = serde_json::from_str(&content) {
                    return s;
                }
            }
        }
        Self::default()
    }

    pub fn save(&self) -> Result<(), String> {
        let p = Self::path();
        let content = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        fs::write(&p, content).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn load_settings() -> AppSettings {
    AppSettings::load()
}

#[tauri::command]
pub fn save_settings(settings: AppSettings) -> Result<(), String> {
    settings.save()
}