use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Emitter;
use tauri_plugin_autostart::ManagerExt;

static SETTINGS_LOCK: Mutex<()> = Mutex::new(());

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
    /// Last local model that was loaded; used by "Load last model" in the tray.
    /// Persisted so it survives restarts — there is no separate in-memory copy.
    #[serde(default)]
    pub last_local_model_file: String,
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
    pub process_api_key_opencode_go: String,
    pub process_api_key_custom: String,
    pub process_model: String,
    #[serde(default = "default_endpoint")]
    pub process_endpoint: String,
    /// Seconds to wait for AI refining before falling back to raw text (3–120).
    #[serde(default = "default_process_timeout")]
    pub process_timeout_secs: u32,
    pub process_max_tokens: u32,
    /// Minimum word count before AI processing runs (1–20, 0 = always run).
    #[serde(default = "default_process_min_words")]
    pub process_min_words: u32,
    pub process_agent_profile: String,
    pub process_agent_name: String,
    pub process_agent_prompt: String,
    pub words_enabled: bool,
    #[serde(default = "default_true")]
    pub words_auto_scan: bool,
    pub hotkey: String,
    pub hotkey_mode: String,
    pub paste_method: String,
    pub paste_tool: String,
    pub vad_enabled: bool,
    pub vad_threshold: f32,
    pub noise_suppression_enabled: bool,
    pub noise_suppression_level: f32,
    pub language: String,
    #[serde(default = "default_enabled_languages")]
    pub enabled_languages: Vec<String>,
    pub keep_recordings: bool,
    pub launch_to_tray: bool,
    pub autostart: bool,
    pub overlay_enabled: bool,
    pub overlay_position: String,
    /// Master toggle for all sound cues.
    #[serde(default = "default_true")]
    pub sound_enabled: bool,
    /// Per-event sound cues (distinct wav per action, user can enable any).
    #[serde(default)]
    pub sound_on_start: bool,
    #[serde(default)]
    pub sound_on_done: bool,
    #[serde(default = "default_true")]
    pub sound_on_cancel: bool,
    #[serde(default = "default_true")]
    pub sound_on_error: bool,
    /// Selected input device name; empty string = system default.
    pub input_device: String,
    /// Cumulative seconds saved by speaking instead of typing (estimated).
    pub time_saved_sec: i64,
    /// Maximum history entries to retain (0 = unlimited).
    #[serde(default = "default_max_history")]
    pub max_history_entries: i32,
    /// What to delete when trimming: "both" or "recordings_only".
    #[serde(default = "default_retention_mode")]
    pub history_retention_mode: String,
}

fn default_max_history() -> i32 {
    500
}
fn default_retention_mode() -> String {
    "both".into()
}
fn default_true() -> bool {
    true
}
fn default_endpoint() -> String {
    "/chat/completions".into()
}
fn default_process_timeout() -> u32 {
    15
}
fn default_process_min_words() -> u32 {
    6
}

fn default_enabled_languages() -> Vec<String> {
    vec!["auto".into()]
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
            last_local_model_file: String::new(),
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
            process_api_key_opencode_go: String::new(),
            process_api_key_custom: String::new(),
            process_model: String::new(),
            process_endpoint: "/chat/completions".into(),
            process_timeout_secs: default_process_timeout(),
            process_max_tokens: 0,
            process_min_words: default_process_min_words(),
            process_agent_profile: "auto".into(),
            process_agent_name: "Auto-Format".into(),
            process_agent_prompt: String::new(),
            words_enabled: true,
            words_auto_scan: true,
            hotkey: "F9".into(),
            hotkey_mode: "push-to-talk".into(),
            paste_method: "Direct Typing".into(),
            paste_tool: "auto".into(),
            vad_enabled: true,
            vad_threshold: 0.01,
            noise_suppression_enabled: false,
            noise_suppression_level: 0.5,
            language: "auto".into(),
            enabled_languages: default_enabled_languages(),
            keep_recordings: false,
            launch_to_tray: false,
            autostart: false,
            overlay_enabled: true,
            overlay_position: "bottom".into(),
            sound_enabled: true,
            sound_on_start: false,
            sound_on_done: false,
            sound_on_cancel: true,
            sound_on_error: true,
            input_device: String::new(),
            time_saved_sec: 0,
            max_history_entries: default_max_history(),
            history_retention_mode: default_retention_mode(),
        }
    }
}

impl AppSettings {
    fn path() -> PathBuf {
        let mut p = dirs::config_local_dir().unwrap_or_else(|| PathBuf::from("."));
        p.push(crate::app_info::data_dir_name());
        let _ = fs::create_dir_all(&p);
        p.push("settings.json");
        p
    }

    pub fn load() -> Self {
        let p = Self::path();
        if p.exists() {
            if let Ok(content) = fs::read_to_string(&p) {
                if let Ok(mut s) = serde_json::from_str::<Self>(&content) {
                    s.process_timeout_secs = s.process_timeout_secs.clamp(3, 120);
                    s.process_min_words = s.process_min_words.clamp(0, 20);
                    s.vad_threshold = s.vad_threshold.clamp(0.0, 1.0);
                    s.noise_suppression_level = s.noise_suppression_level.clamp(0.0, 1.0);
                    if s.max_history_entries < 0 {
                        s.max_history_entries = 0;
                    }
                    if s.enabled_languages.is_empty() {
                        s.enabled_languages = default_enabled_languages();
                    }
                    if s.enabled_languages == vec!["auto".to_string()]
                        && s.language != "auto"
                        && !s.language.is_empty()
                    {
                        s.enabled_languages = vec![s.language.clone()];
                    }
                    return s;
                }
            }
        }
        Self::default()
    }

    pub fn save(&self) -> Result<(), String> {
        let p = Self::path();
        let content = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        let tmp = p.with_extension("json.tmp");
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            let mut opts = fs::OpenOptions::new();
            opts.write(true).create(true).truncate(true).mode(0o600);
            let mut f = opts.open(&tmp).map_err(|e| e.to_string())?;
            use std::io::Write;
            f.write_all(content.as_bytes()).map_err(|e| e.to_string())?;
            f.sync_all().map_err(|e| e.to_string())?;
        }
        #[cfg(not(unix))]
        {
            fs::write(&tmp, &content).map_err(|e| e.to_string())?;
        }
        fs::rename(&tmp, &p).map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[tauri::command]
pub fn load_settings() -> AppSettings {
    AppSettings::load()
}

/// Derive ALL runtime state from settings. This is the single place where
/// mirrors of `AppSettings` are written — never set those statics elsewhere.
pub fn sync_runtime(settings: &AppSettings) {
    // Hotkey / recording behaviour
    crate::coordinator::HOTKEY_MODE.store(
        settings.hotkey_mode != "toggle",
        std::sync::atomic::Ordering::Relaxed,
    );
    crate::coordinator::KEEP_RECORDINGS.store(
        settings.keep_recordings,
        std::sync::atomic::Ordering::Relaxed,
    );
    crate::coordinator::WORDS_ENABLED
        .store(settings.words_enabled, std::sync::atomic::Ordering::Relaxed);
    crate::coordinator::WORDS_AUTO_SCAN.store(
        settings.words_auto_scan,
        std::sync::atomic::Ordering::Relaxed,
    );
    crate::coordinator::VAD_ENABLED
        .store(settings.vad_enabled, std::sync::atomic::Ordering::Relaxed);
    crate::coordinator::VAD_THRESHOLD.store(
        settings.vad_threshold.to_bits(),
        std::sync::atomic::Ordering::Relaxed,
    );
    crate::coordinator::NOISE_SUPPRESSION_ENABLED.store(
        settings.noise_suppression_enabled,
        std::sync::atomic::Ordering::Relaxed,
    );
    crate::coordinator::NOISE_SUPPRESSION_LEVEL.store(
        settings.noise_suppression_level.to_bits(),
        std::sync::atomic::Ordering::Relaxed,
    );
    // Process settings are read per-dictation from AppSettings::load() in the
    // coordinator — no mirrors needed (single source of truth).
    {
        let mut method = crate::coordinator::PASTE_METHOD
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        *method = settings.paste_method.clone();
    }
    {
        let mut tool = crate::coordinator::PASTE_TOOL
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        *tool = settings.paste_tool.clone();
    }
    {
        let mut v = crate::coordinator::INPUT_DEVICE
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        *v = settings.input_device.clone();
    }

    // Cloud engine
    {
        let mut v = crate::coordinator::CLOUD_PROVIDER
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        *v = settings.engine_provider.clone();
    }
    {
        let mut v = crate::coordinator::CLOUD_BASE_URL
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        *v = settings.engine_base_url.clone();
    }
    {
        let mut v = crate::coordinator::CLOUD_API_KEY
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        *v = settings.voice_api_key.clone();
    }
    {
        let mut v = crate::coordinator::CLOUD_MODEL
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        *v = settings.engine_model.clone();
    }

    // Engine mode + current local model path (derived, not stored twice)
    {
        let mut mode = crate::coordinator::ENGINE_MODE
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        *mode = settings.engine_mode.clone();
    }
    {
        let mut v = crate::coordinator::ENGINE_LANGUAGE
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        *v = settings.language.clone();
    }
    {
        let mut v = crate::coordinator::ENABLED_LANGUAGES
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        *v = settings.enabled_languages.clone();
    }
    let model_dir = crate::models::get_models_dir();
    let model_path = model_dir.join(&settings.local_model_file);
    let model_exists = model_path.exists();
    {
        let mut current = crate::coordinator::CURRENT_MODEL
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        *current = if model_exists { Some(model_path) } else { None };
    }

    // Display name (derived from mode + model)
    {
        let mut name = crate::coordinator::MODEL_DISPLAY_NAME
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        if settings.engine_mode == "cloud" {
            let provider_label = match settings.engine_provider.as_str() {
                "openai" => "OpenAI",
                "groq" => "Groq",
                _ => "Custom",
            };
            *name = format!("{} · {}", provider_label, settings.engine_model);
        } else if model_exists {
            *name =
                crate::coordinator::model_display_name(&model_dir.join(&settings.local_model_file));
        } else {
            name.clear();
        }
    }

    // Overlay
    {
        let mut en = crate::OVERLAY_ENABLED
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        *en = settings.overlay_enabled;
    }
    {
        let mut pos = crate::OVERLAY_POSITION
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        *pos = if settings.overlay_position == "top" {
            "top".into()
        } else {
            "bottom".into()
        };
    }
    crate::coordinator::SOUND_ENABLED
        .store(settings.sound_enabled, std::sync::atomic::Ordering::Relaxed);
    crate::coordinator::SOUND_ON_START.store(
        settings.sound_on_start,
        std::sync::atomic::Ordering::Relaxed,
    );
    crate::coordinator::SOUND_ON_DONE
        .store(settings.sound_on_done, std::sync::atomic::Ordering::Relaxed);
    crate::coordinator::SOUND_ON_CANCEL.store(
        settings.sound_on_cancel,
        std::sync::atomic::Ordering::Relaxed,
    );
    crate::coordinator::SOUND_ON_ERROR.store(
        settings.sound_on_error,
        std::sync::atomic::Ordering::Relaxed,
    );
}

/// The ONLY mutation funnel for settings:
/// load → mutate → save → sync_runtime → tray refresh → notify frontend.
/// Every settings change must go through here.
pub fn apply(app: &tauri::AppHandle, mutate: impl FnOnce(&mut AppSettings)) -> usize {
    let _guard = SETTINGS_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let prev = AppSettings::load();
    let prev_max = prev.max_history_entries;
    let prev_mode = prev.history_retention_mode.clone();
    let prev_hotkey = prev.hotkey.clone();
    let prev_words_enabled = prev.words_enabled;
    let mut s = AppSettings::load();
    mutate(&mut s);
    // Clamp retention limit to sane range (0 = unlimited)
    if s.max_history_entries < 0 {
        s.max_history_entries = 0;
    }
    // Clamp process settings to sane ranges (protect against hand-edited JSON)
    s.process_timeout_secs = s.process_timeout_secs.clamp(3, 120);
    s.process_min_words = s.process_min_words.clamp(0, 20);
    s.process_max_tokens = s.process_max_tokens.min(100_000);
    s.vad_threshold = s.vad_threshold.clamp(0.0, 1.0);
    s.noise_suppression_level = s.noise_suppression_level.clamp(0.0, 1.0);
    let do_trim = s.max_history_entries != prev_max || s.history_retention_mode != prev_mode;
    let _ = s.save();
    sync_runtime(&s);
    // Seed built-in dictionary entry only the first time the user enables it.
    if !prev_words_enabled && s.words_enabled {
        let mgr = crate::words::WordsManager::new();
        if let Ok(all) = mgr.all() {
            if !all.iter().any(|e| e.phrase.to_lowercase() == "wisper") {
                let _ = mgr.add("Wisper", "whisper, wispr", false, true, false);
            }
        }
    }
    // If the hotkey changed via save_settings (e.g. tab reset), re-register it at the OS level.
    // set_hotkey does this, but save_settings is the path used by Reset.
    if s.hotkey != prev_hotkey {
        let _ = crate::whisper_keys::register(&s.hotkey);
    }

    let trimmed = if do_trim && s.max_history_entries > 0 {
        let mode = if s.keep_recordings && s.history_retention_mode == "recordings_only" {
            "recordings_only"
        } else {
            "both"
        };
        crate::history::HistoryManager::new()
            .trim_history(s.max_history_entries as i64, mode)
            .unwrap_or(0)
    } else {
        0
    };

    if s.autostart {
        let _ = app.autolaunch().enable();
    } else {
        let _ = app.autolaunch().disable();
    }

    crate::tray::refresh();
    let _ = app.emit("wisper:settings-changed", &s);
    trimmed
}

pub fn add_time_saved(delta: i64) {
    if delta <= 0 {
        return;
    }
    let _guard = SETTINGS_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut s = AppSettings::load();
    s.time_saved_sec = s.time_saved_sec.saturating_add(delta);
    let _ = s.save();
}

// ── Shared engine operations ────────────────────────────────────────────────
// Used by BOTH the tray menu handlers and the tauri commands so the logic
// exists in exactly one place.

/// Keep model state consistent across an engine-mode change:
/// going to cloud automatically unloads the local model (remembering it),
/// coming back to local automatically reloads the last used model.
fn apply_engine_transition(s: &mut AppSettings, prev_mode: &str) {
    if s.engine_mode == prev_mode {
        return;
    }
    if s.engine_mode == "cloud" {
        if !s.local_model_file.is_empty() {
            s.last_local_model_file = std::mem::take(&mut s.local_model_file);
        }
    } else if s.local_model_file.is_empty() && !s.last_local_model_file.is_empty() {
        s.local_model_file = s.last_local_model_file.clone();
    }
}

pub fn unload_local_model(app: &tauri::AppHandle) {
    apply(app, |s| {
        s.last_local_model_file = std::mem::take(&mut s.local_model_file);
    });
}

pub fn reload_last_model(app: &tauri::AppHandle) {
    apply(app, |s| {
        if s.local_model_file.is_empty() && !s.last_local_model_file.is_empty() {
            s.local_model_file = s.last_local_model_file.clone();
        }
    });
}

pub fn switch_engine_mode(app: &tauri::AppHandle) {
    let prev_mode = AppSettings::load().engine_mode;
    apply(app, |s| {
        s.engine_mode = if prev_mode == "cloud" {
            "local"
        } else {
            "cloud"
        }
        .into();
        apply_engine_transition(s, &prev_mode);
    });
}

#[tauri::command]
pub fn save_settings(app: tauri::AppHandle, settings: AppSettings) -> Result<usize, String> {
    let prev_mode = AppSettings::load().engine_mode;
    let trimmed = apply(&app, |s| {
        *s = settings;
        apply_engine_transition(s, &prev_mode);
    });
    Ok(trimmed)
}

#[tauri::command]
pub fn get_default_settings() -> AppSettings {
    AppSettings::default()
}
