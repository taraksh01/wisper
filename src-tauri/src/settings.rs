use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub stt_mode: String,
    pub stt_provider: String,
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
    pub language: String,
    pub keep_recordings: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            stt_mode: "local".into(),
            stt_provider: "openai".into(),
            stt_base_url: String::new(),
            stt_api_key: String::new(),
            stt_model: "whisper-1".into(),
            local_model_file: "parakeet-tdt-0.6b-v3-int8".into(),
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
            language: "auto".into(),
            keep_recordings: false,
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

pub fn update_display_name(settings: &AppSettings) {
    if let Ok(mut mode) = crate::coordinator::STT_MODE.lock() {
        *mode = settings.stt_mode.clone();
    }
    if let Ok(mut name) = crate::coordinator::MODEL_DISPLAY_NAME.lock() {
        if settings.stt_mode == "cloud" {
            let provider_label = match settings.stt_provider.as_str() {
                "openai" => "OpenAI",
                "groq" => "Groq",
                _ => "Custom",
            };
            *name = format!("{} · {}", provider_label, settings.stt_model);
        } else {
            let model_dir = crate::models::get_models_dir();
            let model_path = model_dir.join(&settings.local_model_file);
            if model_path.exists() {
                *name = crate::coordinator::model_display_name(&model_path);
            } else {
                name.clear();
            }
        }
    }
}

#[tauri::command]
pub fn save_settings(settings: AppSettings) -> Result<(), String> {
    crate::coordinator::HOTKEY_MODE.store(
        settings.hotkey_mode != "toggle",
        std::sync::atomic::Ordering::Relaxed,
    );
    crate::coordinator::KEEP_RECORDINGS.store(settings.keep_recordings, std::sync::atomic::Ordering::Relaxed);
    if let Ok(mut method) = crate::coordinator::PASTE_METHOD.lock() {
        *method = settings.paste_method.clone();
    }
    if let Ok(mut v) = crate::coordinator::CLOUD_PROVIDER.lock() {
        *v = settings.stt_provider.clone();
    }
    if let Ok(mut v) = crate::coordinator::CLOUD_BASE_URL.lock() {
        *v = settings.stt_base_url.clone();
    }
    if let Ok(mut v) = crate::coordinator::CLOUD_API_KEY.lock() {
        *v = settings.stt_api_key.clone();
    }
    if let Ok(mut v) = crate::coordinator::CLOUD_MODEL.lock() {
        *v = settings.stt_model.clone();
    }

    // Update current model path
    let model_dir = crate::models::get_models_dir();
    let model_path = model_dir.join(&settings.local_model_file);
    if let Ok(mut current) = crate::coordinator::CURRENT_MODEL.lock() {
        *current = if model_path.exists() { Some(model_path.clone()) } else { None };
    }

    update_display_name(&settings);
    crate::update_tray_menu_text();

    settings.save()
}

#[tauri::command]
pub fn get_default_settings() -> AppSettings {
    AppSettings::default()
}