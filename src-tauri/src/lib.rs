pub mod audio;
pub mod coordinator;
pub mod history;
pub mod hotkey;
pub mod llm;
pub mod models;
pub mod paste;
pub mod settings;
pub mod stt;
pub mod vocab;
pub mod whisper_keys;

use audio::AudioRecorder;
use coordinator::{CoordinatorCommand, CoordinatorState, TranscriptionCoordinator};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;

const DEFAULT_HOTKEY: &str = "F9";

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WindowEvent,
};
use tauri_plugin_autostart::ManagerExt;

static UNLOAD_ITEM: once_cell::sync::Lazy<std::sync::Mutex<Option<MenuItem<tauri::Wry>>>> =
    once_cell::sync::Lazy::new(|| std::sync::Mutex::new(None));

static APP_HANDLE: once_cell::sync::Lazy<std::sync::Mutex<Option<tauri::AppHandle>>> =
    once_cell::sync::Lazy::new(|| std::sync::Mutex::new(None));

static STATE_LOCK: once_cell::sync::Lazy<Arc<Mutex<CoordinatorState>>> =
    once_cell::sync::Lazy::new(|| Arc::new(Mutex::new(CoordinatorState::Idle)));

type HotkeySender = Arc<Mutex<mpsc::Sender<hotkey::HotkeyEvent>>>;
static HOTKEY_SENDER: once_cell::sync::Lazy<Mutex<Option<HotkeySender>>> =
    once_cell::sync::Lazy::new(|| Mutex::new(None));

static RECORDER: once_cell::sync::Lazy<std::sync::Mutex<Option<AudioRecorder>>> =
    once_cell::sync::Lazy::new(|| std::sync::Mutex::new(None));

static OVERLAY_ENABLED: once_cell::sync::Lazy<Mutex<bool>> =
    once_cell::sync::Lazy::new(|| Mutex::new(true));
static OVERLAY_POSITION: once_cell::sync::Lazy<Mutex<String>> =
    once_cell::sync::Lazy::new(|| Mutex::new("bottom".to_string()));

#[tauri::command]
fn get_input_level() -> f32 {
    RECORDER
        .lock()
        .unwrap()
        .as_ref()
        .map(|r| r.current_level())
        .unwrap_or(0.0)
}

#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
fn get_paste_environment(preference: String) -> paste::PasteEnvironment {
    paste::get_paste_environment(&preference)
}

#[tauri::command]
fn get_current_state() -> String {
    let state = STATE_LOCK.lock().unwrap();
    format!("{:?}", *state)
}

#[tauri::command]
fn set_hotkey(_app: tauri::AppHandle, key: String) -> Result<(), String> {
    whisper_keys::register(&key)
}

#[tauri::command]
fn get_current_model() -> String {
    coordinator::MODEL_DISPLAY_NAME.lock().unwrap().clone()
}

#[tauri::command]
fn unload_model(_app: tauri::AppHandle) {
    let mode = coordinator::STT_MODE.lock().unwrap().clone();
    if mode == "cloud" {
        if let Some(win) = _app.get_webview_window("main") {
            let _ = win.show();
            let _ = win.set_focus();
        }
        let _ = _app.emit("wisper:open-tab", "stt");
    } else {
        {
            let mut current = coordinator::CURRENT_MODEL.lock().unwrap();
            *current = None;
        }
        {
            let mut name = coordinator::MODEL_DISPLAY_NAME.lock().unwrap();
            name.clear();
        }
        update_tray_menu_text();
    }
}

fn emit_state(app: &tauri::AppHandle, state: CoordinatorState) {
    let label = match state {
        CoordinatorState::Idle => "idle",
        CoordinatorState::Recording => "recording",
        CoordinatorState::Processing => "processing",
    };
    let _ = app.emit("wisper:state", label);
    update_overlay(app, state);
}

/// Detached overlay window: a transparent, decoration-less, non-focusable
/// Tauri webview showing the recording indicator (public/overlay.html).
/// Created hidden, shown during recording/processing, destroyed when idle.
const OVERLAY_LABEL: &str = "wisper-overlay";
const OVERLAY_WIDTH: f64 = 260.0;
const OVERLAY_HEIGHT: f64 = 56.0;
const OVERLAY_TOP_OFFSET: f64 = 4.0;
const OVERLAY_BOTTOM_OFFSET: f64 = 40.0;

#[cfg(target_os = "linux")]
use enigo::Mouse;

/// Cursor position on Wayland: Tauri's cursor_position() returns (0,0), so ask
/// enigo (which talks to the compositor) for the real pointer location.
#[cfg(target_os = "linux")]
fn cursor_pos() -> Option<(i32, i32)> {
    enigo::Enigo::new(&enigo::Settings::default()).ok().and_then(|e| e.location().ok())
}

#[cfg(target_os = "linux")]
fn monitor_with_cursor(app: &tauri::AppHandle) -> Option<tauri::Monitor> {
    if let Some((mx, my)) = cursor_pos() {
        if let Ok(monitors) = app.available_monitors() {
            for m in monitors {
                let p = m.position();
                let s = m.size();
                if mx >= p.x && mx < p.x + s.width as i32 && my >= p.y && my < p.y + s.height as i32 {
                    return Some(m);
                }
            }
        }
    }
    app.primary_monitor().ok().flatten()
}

/// Create the detached overlay window (hidden until recording).
fn create_overlay(app: &tauri::AppHandle) {
    create_overlay_with(app, "overlay.html");
}

fn create_overlay_with(app: &tauri::AppHandle, url: &str) {
    if app.get_webview_window(OVERLAY_LABEL).is_some() {
        return;
    }
    if !*OVERLAY_ENABLED.lock().unwrap() {
        return;
    }
    let builder = tauri::WebviewWindowBuilder::new(app, OVERLAY_LABEL, tauri::WebviewUrl::App(url.into()))
        .title("Wisper")
        .resizable(false)
        .inner_size(OVERLAY_WIDTH, OVERLAY_HEIGHT)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .transparent(true)
        .focusable(false)
        .focused(false)
        .visible(false);
    match builder.build() {
        Ok(win) => {
            let _ = win.hide();
        }
        Err(e) => {
            eprintln!("create_overlay: BUILD FAILED: {}", e);
        }
    }
}

/// Show/hide the overlay, mirroring Handy's show_overlay_state positioning.
fn update_overlay(app: &tauri::AppHandle, state: CoordinatorState) {
    let Some(win) = app.get_webview_window(OVERLAY_LABEL) else {
        if *OVERLAY_ENABLED.lock().unwrap() {
            create_overlay(app);
            return update_overlay(app, state);
        }
        return;
    };
    if !*OVERLAY_ENABLED.lock().unwrap() {
        let _ = win.hide();
        return;
    }
    match state {
        CoordinatorState::Idle => {
            // Destroy so the next recording reloads fresh overlay.html
            // (avoids restarting dev server for HTML tweaks).
            let _ = win.destroy();
        }
        CoordinatorState::Recording | CoordinatorState::Processing => {
            let top = *OVERLAY_POSITION.lock().unwrap() == "top";
            #[cfg(not(target_os = "linux"))]
            let _ = top;
            #[cfg(target_os = "linux")]
            {
                if let Some(monitor) = monitor_with_cursor(app) {
                    let scale = monitor.scale_factor();
                    let mx = monitor.position().x as f64 / scale;
                    let my = monitor.position().y as f64 / scale;
                    let mw = monitor.size().width as f64 / scale;
                    let mh = monitor.size().height as f64 / scale;
                    let x = mx + (mw - OVERLAY_WIDTH) / 2.0;
                    let y = if top { my + OVERLAY_TOP_OFFSET } else { my + mh - OVERLAY_HEIGHT - OVERLAY_BOTTOM_OFFSET };
                    let _ = win.set_position(tauri::LogicalPosition::new(x, y));
                }
            }
            let shown = win.show();
            let _ = shown;
        }
    }
}

/// Hide the overlay window (used before pasting so keyboard focus
/// returns to the target app instead of the overlay).
pub fn hide_overlay() {
    if let Some(handle) = APP_HANDLE.lock().unwrap().as_ref() {
        if let Some(win) = handle.get_webview_window(OVERLAY_LABEL) {
            let _ = win.hide();
        }
    }
}

/// Briefly flash the overlay error glyph (~1.5s) to signal a failed
/// transcription. The window is destroyed afterwards so it can never get
/// stuck in the error state; the next recording builds a fresh normal one.
pub fn show_overlay_error() {
    let Some(handle) = APP_HANDLE.lock().unwrap().as_ref().cloned() else { return };
    if !*OVERLAY_ENABLED.lock().unwrap() {
        return;
    }
    let _ = handle.clone().run_on_main_thread(move || {
        // Start from a clean, normal window.
        if let Some(w) = handle.get_webview_window(OVERLAY_LABEL) {
            let _ = w.destroy();
        }
        create_overlay(&handle);
        let Some(win) = handle.get_webview_window(OVERLAY_LABEL) else { return };
        #[cfg(target_os = "linux")]
        {
            if let Some(monitor) = monitor_with_cursor(&handle) {
                let scale = monitor.scale_factor();
                let mx = monitor.position().x as f64 / scale;
                let my = monitor.position().y as f64 / scale;
                let mw = monitor.size().width as f64 / scale;
                let mh = monitor.size().height as f64 / scale;
                let x = mx + (mw - OVERLAY_WIDTH) / 2.0;
                let y = if *OVERLAY_POSITION.lock().unwrap() == "top" {
                    my + OVERLAY_TOP_OFFSET
                } else {
                    my + mh - OVERLAY_HEIGHT - OVERLAY_BOTTOM_OFFSET
                };
                let _ = win.set_position(tauri::LogicalPosition::new(x, y));
            }
        }
        let _ = win.show();
        let wh = win.clone();
        // Show the error glyph once the webview has loaded window.__mode.
        std::thread::spawn(move || {
            for _ in 0..12 {
                let _ = wh.eval("window.__mode && window.__mode('error')");
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            std::thread::sleep(std::time::Duration::from_millis(900));
            let _ = wh.destroy();
        });
    });
}

pub fn update_tray_menu_text() {
    if let Some(item) = UNLOAD_ITEM.lock().unwrap().as_ref() {
        let name = coordinator::MODEL_DISPLAY_NAME.lock().unwrap().clone();
        let mode = coordinator::STT_MODE.lock().unwrap().clone();
        let text = if name.is_empty() {
            "No model loaded".into()
        } else if mode == "cloud" {
            name.clone()
        } else {
            format!("✕  {}", name.clone())
        };
        let _ = item.set_text(&text);

        // Update tooltip too
        if let Some(handle) = APP_HANDLE.lock().unwrap().as_ref() {
            if let Some(tray) = handle.tray_by_id("main") {
                let state = STATE_LOCK.lock().unwrap();
                let label = match *state {
                    CoordinatorState::Idle => {
                        if name.is_empty() {
                            "Wisper - Idle".into()
                        } else {
                            format!("Wisper - Idle [{}]", name)
                        }
                    }
                    CoordinatorState::Recording => "Wisper - Recording...".into(),
                    CoordinatorState::Processing => "Wisper - Processing...".into(),
                };
                let _ = tray.set_tooltip(Some(&label));
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            let app_handle = app.handle().clone();
            {
                let mut guard = APP_HANDLE.lock().unwrap();
                *guard = Some(app_handle.clone());
            }

            let quit_i = MenuItem::with_id(app, "quit", "Quit Wisper", true, None::<&str>)?;
            let settings_i =
                MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
            let unload_i =
                MenuItem::with_id(app, "unload", "Unload Model", true, None::<&str>)?;
            {
                let mut guard = UNLOAD_ITEM.lock().unwrap();
                *guard = Some(unload_i.clone());
            }
            // Set initial text if model is loaded
            {
                let name = coordinator::MODEL_DISPLAY_NAME.lock().unwrap();
                if !name.is_empty() {
                    let _ = unload_i.set_text(&format!("✕  {}", name));
                }
            }
            let menu = Menu::with_items(app, &[&settings_i, &unload_i, &quit_i])?;

            let tray = TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .tooltip("Wisper - Idle")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        app.exit(0);
                    }
                    "settings" => {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                    "unload" => {
                        let mode = coordinator::STT_MODE.lock().unwrap().clone();
                        if mode == "cloud" {
                            if let Some(win) = app.get_webview_window("main") {
                                let _ = win.show();
                                let _ = win.set_focus();
                            }
                            let _ = app.emit("wisper:open-tab", "stt");
                        } else {
                            {
                                let mut current = coordinator::CURRENT_MODEL.lock().unwrap();
                                *current = None;
                            }
                            {
                                let mut name = coordinator::MODEL_DISPLAY_NAME.lock().unwrap();
                                name.clear();
                            }
                            update_tray_menu_text();
                            if let Some(tray) = app.tray_by_id("main") {
                                let _ = tray.set_tooltip(Some("Wisper - No model loaded"));
                            }
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                })
                .build(app)?;

            let (cmd_tx, cmd_rx) = mpsc::channel();
            let (state_tx, state_rx) = mpsc::channel();

            let (hk_tx, hk_rx) = mpsc::channel();
            {
                let sender: HotkeySender = Arc::new(Mutex::new(hk_tx.clone()));
                *HOTKEY_SENDER.lock().unwrap() = Some(sender);
            }
            thread::spawn(move || {
                while let Ok(event) = hk_rx.recv() {
                    let _ = cmd_tx.send(CoordinatorCommand::Hotkey(event));
                }
            });

    // Load saved settings
    let saved_settings = settings::AppSettings::load();
    coordinator::HOTKEY_MODE.store(
        saved_settings.hotkey_mode != "toggle",
        std::sync::atomic::Ordering::Relaxed,
    );
    coordinator::KEEP_RECORDINGS.store(saved_settings.keep_recordings, std::sync::atomic::Ordering::Relaxed);
    coordinator::LLM_ENABLED.store(saved_settings.llm_enabled, std::sync::atomic::Ordering::Relaxed);
    coordinator::VOCAB_ENABLED.store(saved_settings.vocabulary_enabled, std::sync::atomic::Ordering::Relaxed);
    if let Ok(mut v) = coordinator::LLM_BASE_URL.lock() {
        *v = saved_settings.llm_base_url.clone();
    }
    if let Ok(mut v) = coordinator::LLM_API_KEY.lock() {
        *v = saved_settings.llm_api_key.clone();
    }
    if let Ok(mut v) = coordinator::LLM_MODEL.lock() {
        *v = saved_settings.llm_model.clone();
    }
    coordinator::LLM_MAX_TOKENS.store(saved_settings.llm_max_tokens, std::sync::atomic::Ordering::Relaxed);
    if let Ok(mut method) = coordinator::PASTE_METHOD.lock() {
        *method = saved_settings.paste_method.clone();
    }
    if let Ok(mut backend) = coordinator::PASTE_BACKEND.lock() {
        *backend = paste::resolve_paste_backend(&saved_settings.paste_tool);
    }
    if let Ok(mut tool) = coordinator::PASTE_TOOL.lock() {
        *tool = saved_settings.paste_tool.clone();
    }
    if let Ok(mut v) = coordinator::CLOUD_PROVIDER.lock() {
        *v = saved_settings.stt_provider.clone();
    }
    if let Ok(mut v) = coordinator::CLOUD_BASE_URL.lock() {
        *v = saved_settings.stt_base_url.clone();
    }
    if let Ok(mut v) = coordinator::CLOUD_API_KEY.lock() {
        *v = saved_settings.voice_api_key.clone();
    }
    if let Ok(mut v) = coordinator::CLOUD_MODEL.lock() {
        *v = saved_settings.stt_model.clone();
    }

    // Load current model path and update display name
    {
        let model_dir = models::get_models_dir();
        let model_path = model_dir.join(&saved_settings.local_model_file);
        if let Ok(mut current) = coordinator::CURRENT_MODEL.lock() {
            *current = if model_path.exists() { Some(model_path.clone()) } else { None };
        }
    }
    settings::update_display_name(&saved_settings);

            {
                let mut en = OVERLAY_ENABLED.lock().unwrap();
                *en = saved_settings.overlay_enabled;
                let mut pos = OVERLAY_POSITION.lock().unwrap();
                *pos = if saved_settings.overlay_position == "top" { "top".into() } else { "bottom".into() };
            }

            if saved_settings.autostart {
                let _ = app.autolaunch().enable();
            } else {
                let _ = app.autolaunch().disable();
            }

            // Show the window on startup unless the user prefers launching to
            // the tray only (they still need the window to configure the app).
            if !saved_settings.launch_to_tray {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.show();
                    let _ = win.set_focus();
                }
            }

            let recorder = AudioRecorder::new();
            {
                let mut guard = RECORDER.lock().unwrap();
                *guard = Some(recorder.clone());
            }
            let coordinator =
                TranscriptionCoordinator::new(recorder, cmd_rx, Some(state_tx));

            // Spawn Coordinator
            thread::Builder::new()
                .stack_size(8 * 1024 * 1024)
                .spawn(move || {
                    coordinator.run();
                })
                .unwrap();

            // Register the global hotkey via whisper-keys (raw input hook:
            // works uniformly across X11/Wayland and every focused app).
            whisper_keys::init(&app.handle());
            create_overlay(&app.handle());
            let saved = &saved_settings.hotkey;
            if whisper_keys::register(saved).is_err() && saved != DEFAULT_HOTKEY {
                eprintln!("Hotkey {:?} failed to register; using default {:?}", saved, DEFAULT_HOTKEY);
                if let Err(e2) = whisper_keys::register(DEFAULT_HOTKEY) {
                    eprintln!("Failed to register default hotkey: {}", e2);
                }
            }

            // Spawn State Listener -> Tray + State Lock + Frontend Events
            let app_handle_clone = app_handle.clone();
            thread::spawn(move || {
                while let Ok(state) = state_rx.recv() {
                    let model_name = coordinator::MODEL_DISPLAY_NAME.lock().unwrap().clone();
                    let tooltip = match state {
                        CoordinatorState::Idle => {
                            if model_name.is_empty() {
                                "Wisper - Idle".into()
                            } else {
                                format!("Wisper - Idle [{}]", model_name)
                            }
                        }
                        CoordinatorState::Recording => "Wisper - Recording...".into(),
                        CoordinatorState::Processing => "Wisper - Processing...".into(),
                    };
                    let _ = tray.set_tooltip(Some(&tooltip));
                    {
                        let mut lock = STATE_LOCK.lock().unwrap();
                        *lock = state;
                    }
                    emit_state(&app_handle_clone, state);
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                window.hide().unwrap();
                api.prevent_close();
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_app_version,
            get_paste_environment,
            get_input_level,
            get_current_state,
            get_current_model,
            unload_model,
            set_hotkey,
            models::list_local_models,
            models::download_model,
            models::delete_model,
            models::get_models_dir_path,
            llm::get_agent_profiles,
            vocab::get_vocabulary,
            vocab::add_vocab_entry,
            vocab::update_vocab_entry,
            vocab::delete_vocab_entry,
            vocab::suggest_vocabulary,
            vocab::ignore_vocab_suggestion,
            vocab::get_ignored_terms,
            vocab::unignore_vocab_term,
            vocab::add_ignored_to_dictionary,
            history::get_history_entries,
            history::get_history_stats,
            history::delete_history_entry,
            history::update_history_entry,
            history::retranscribe_recording,
            history::get_recording_data,
            history::clear_history,
            settings::load_settings,
            settings::save_settings,
            settings::get_default_settings
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
