use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri_plugin_autostart::ManagerExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AppSettings {
    pub engine_mode: String,
    pub engine_provider: String,
    pub engine_base_url: String,
    pub voice_api_key: String,
    pub voice_api_key_openai: String,
    pub voice_api_key_groq: String,
    pub voice_api_key_custom: String,
    pub engine_model: String,
    pub local_model_file: String,
    pub process_enabled: bool,
    pub process_provider: String,
    pub process_base_url: String,
    pub process_api_key: String,
    pub process_api_key_openai: String,
    pub process_api_key_anthropic: String,
    pub process_api_key_google: String,
    pub process_api_key_groq: String,
    pub process_api_key_together: String,
    pub process_api_key_deepseek: String,
    pub process_api_key_kimi: String,
    pub process_api_key_qwen: String,
    pub process_api_key_glm: String,
    pub process_api_key_openrouter: String,
    pub process_api_key_ollama: String,
    pub process_api_key_custom: String,
    pub process_model: String,
    pub process_max_tokens: u32,
    pub process_agent_profile: String,
    pub process_agent_name: String,
    pub process_agent_prompt: String,
    pub words_enabled: bool,
    pub hotkey: String,
    pub hotkey_mode: String,
    pub paste_method: String,
    pub paste_tool: String,
    pub vad_enabled: bool,
    pub vad_threshold: f32,
    pub language: String,
    pub keep_recordings: bool,
    pub launch_to_tray: bool,
    pub autostart: bool,
    pub overlay_enabled: bool,
    pub overlay_position: String,
    /// Selected input device name; empty string = system default.
    pub input_device: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            engine_mode: "local".into(),
            engine_provider: String::new(),
            engine_base_url: String::new(),
            voice_api_key: String::new(),
            voice_api_key_openai: String::new(),
            voice_api_key_groq: String::new(),
            voice_api_key_custom: String::new(),
            engine_model: String::new(),
            local_model_file: String::new(),
            process_enabled: false,
            process_provider: String::new(),
            process_base_url: String::new(),
            process_api_key: String::new(),
            process_api_key_openai: String::new(),
            process_api_key_anthropic: String::new(),
            process_api_key_google: String::new(),
            process_api_key_groq: String::new(),
            process_api_key_together: String::new(),
            process_api_key_deepseek: String::new(),
            process_api_key_kimi: String::new(),
            process_api_key_qwen: String::new(),
            process_api_key_glm: String::new(),
            process_api_key_openrouter: String::new(),
            process_api_key_ollama: String::new(),
            process_api_key_custom: String::new(),
            process_model: String::new(),
            process_max_tokens: 0,
            process_agent_profile: "auto".into(),
            process_agent_name: "Auto-Format".into(),
            process_agent_prompt: String::new(),
            words_enabled: true,
            hotkey: "F9".into(),
            hotkey_mode: "push-to-talk".into(),
            paste_method: "Ctrl+V".into(),
            paste_tool: "auto".into(),
            vad_enabled: true,
            vad_threshold: 0.01,
            language: "auto".into(),
            keep_recordings: false,
            launch_to_tray: false,
            autostart: false,
            overlay_enabled: true,
            overlay_position: "bottom".into(),
            input_device: String::new(),
        }
    }
}

impl AppSettings {
    fn path() -> PathBuf {
        let mut p = dirs::config_local_dir().unwrap_or_else(|| PathBuf::from("."));
        p.push("wisper");
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
    if let Ok(mut mode) = crate::coordinator::ENGINE_MODE.lock() {
        *mode = settings.engine_mode.clone();
    }
    if let Ok(mut name) = crate::coordinator::MODEL_DISPLAY_NAME.lock() {
        if settings.engine_mode == "cloud" {
            let provider_label = match settings.engine_provider.as_str() {
                "openai" => "OpenAI",
                "groq" => "Groq",
                _ => "Custom",
            };
            *name = format!("{} · {}", provider_label, settings.engine_model);
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
pub fn save_settings(app: tauri::AppHandle, settings: AppSettings) -> Result<(), String> {
    eprintln!("[save_settings] called with {} fields", serde_json::to_string(&settings).unwrap_or_default().len());
    let path = AppSettings::path();
    eprintln!("[save_settings] path: {:?}", path);
    crate::coordinator::HOTKEY_MODE.store(
        settings.hotkey_mode != "toggle",
        std::sync::atomic::Ordering::Relaxed,
    );
    crate::coordinator::KEEP_RECORDINGS.store(settings.keep_recordings, std::sync::atomic::Ordering::Relaxed);
    crate::coordinator::PROCESS_ENABLED.store(settings.process_enabled, std::sync::atomic::Ordering::Relaxed);
    crate::coordinator::WORDS_ENABLED.store(settings.words_enabled, std::sync::atomic::Ordering::Relaxed);
    crate::coordinator::VAD_ENABLED.store(settings.vad_enabled, std::sync::atomic::Ordering::Relaxed);
    crate::coordinator::VAD_THRESHOLD.store(settings.vad_threshold.to_bits(), std::sync::atomic::Ordering::Relaxed);
    if let Ok(mut v) = crate::coordinator::PROCESS_BASE_URL.lock() {
        *v = settings.process_base_url.clone();
    }
    if let Ok(mut v) = crate::coordinator::PROCESS_API_KEY.lock() {
        *v = settings.process_api_key.clone();
    }
    if let Ok(mut v) = crate::coordinator::PROCESS_MODEL.lock() {
        *v = settings.process_model.clone();
    }
    crate::coordinator::PROCESS_MAX_TOKENS.store(settings.process_max_tokens, std::sync::atomic::Ordering::Relaxed);
    if let Ok(mut method) = crate::coordinator::PASTE_METHOD.lock() {
        *method = settings.paste_method.clone();
    }
    if let Ok(mut backend) = crate::coordinator::PASTE_BACKEND.lock() {
        *backend = crate::paste::resolve_paste_backend(&settings.paste_tool);
    }
    if let Ok(mut tool) = crate::coordinator::PASTE_TOOL.lock() {
        *tool = settings.paste_tool.clone();
    }
    if let Ok(mut v) = crate::coordinator::CLOUD_PROVIDER.lock() {
        *v = settings.engine_provider.clone();
    }
    if let Ok(mut v) = crate::coordinator::CLOUD_BASE_URL.lock() {
        *v = settings.engine_base_url.clone();
    }
    if let Ok(mut v) = crate::coordinator::CLOUD_API_KEY.lock() {
        *v = settings.voice_api_key.clone();
    }
    if let Ok(mut v) = crate::coordinator::CLOUD_MODEL.lock() {
        *v = settings.engine_model.clone();
    }
    if let Ok(mut v) = crate::coordinator::INPUT_DEVICE.lock() {
        *v = settings.input_device.clone();
    }

    // Update current model path
    let model_dir = crate::models::get_models_dir();
    let model_path = model_dir.join(&settings.local_model_file);
    if let Ok(mut current) = crate::coordinator::CURRENT_MODEL.lock() {
        *current = if model_path.exists() { Some(model_path.clone()) } else { None };
    }

    update_display_name(&settings);

    if let Ok(mut en) = crate::OVERLAY_ENABLED.lock() {
        *en = settings.overlay_enabled;
    }
    if let Ok(mut pos) = crate::OVERLAY_POSITION.lock() {
        *pos = if settings.overlay_position == "top" { "top".into() } else { "bottom".into() };
    }

    if settings.autostart {
        let _ = app.autolaunch().enable();
    } else {
        let _ = app.autolaunch().disable();
    }

    crate::update_tray_menu_text();

    let result = settings.save();
    eprintln!("[save_settings] result: {:?}", result);
    result
}

#[tauri::command]
pub fn get_default_settings() -> AppSettings {
    AppSettings::default()
}