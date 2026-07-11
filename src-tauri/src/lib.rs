pub mod audio;
pub mod coordinator;
pub mod history;
pub mod hotkey;
pub mod llm;
pub mod models;
pub mod paste;
pub mod settings;
pub mod stt;

use audio::AudioRecorder;
use coordinator::{CoordinatorCommand, CoordinatorState, TranscriptionCoordinator};
use hotkey::HotkeyManager;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WindowEvent,
};

static UNLOAD_ITEM: once_cell::sync::Lazy<std::sync::Mutex<Option<MenuItem<tauri::Wry>>>> =
    once_cell::sync::Lazy::new(|| std::sync::Mutex::new(None));

static APP_HANDLE: once_cell::sync::Lazy<std::sync::Mutex<Option<tauri::AppHandle>>> =
    once_cell::sync::Lazy::new(|| std::sync::Mutex::new(None));

static STATE_LOCK: once_cell::sync::Lazy<Arc<Mutex<CoordinatorState>>> =
    once_cell::sync::Lazy::new(|| Arc::new(Mutex::new(CoordinatorState::Idle)));

static HOTKEY_BINDING: once_cell::sync::Lazy<Arc<Mutex<hotkey::HotkeyBinding>>> =
    once_cell::sync::Lazy::new(|| {
        Arc::new(Mutex::new(hotkey::HotkeyBinding {
            ctrl: false,
            alt: false,
            shift: false,
            meta: false,
            key: rdev::Key::F12,
        }))
    });

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
fn set_hotkey(key: String) -> Result<(), String> {
    let binding = hotkey::parse_binding(&key)
        .ok_or_else(|| format!("Invalid key combination: {}", key))?;
    if let Ok(mut current) = HOTKEY_BINDING.lock() {
        *current = binding;
    }
    Ok(())
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
    if let Ok(mut v) = coordinator::LLM_BASE_URL.lock() {
        *v = saved_settings.llm_base_url.clone();
    }
    if let Ok(mut v) = coordinator::LLM_API_KEY.lock() {
        *v = saved_settings.llm_api_key.clone();
    }
    if let Ok(mut v) = coordinator::LLM_MODEL.lock() {
        *v = saved_settings.llm_model.clone();
    }
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

            let initial_binding = hotkey::parse_binding(&saved_settings.hotkey)
                .unwrap_or(hotkey::HotkeyBinding {
                    ctrl: false,
                    alt: false,
                    shift: false,
                    meta: false,
                    key: rdev::Key::F12,
                });
            {
                let mut hk = HOTKEY_BINDING.lock().unwrap();
                *hk = initial_binding.clone();
            }

            let recorder = AudioRecorder::new();
            let coordinator =
                TranscriptionCoordinator::new(recorder, cmd_rx, Some(state_tx));

            // Spawn Coordinator
            thread::Builder::new()
                .stack_size(8 * 1024 * 1024)
                .spawn(move || {
                    coordinator.run();
                })
                .unwrap();

            // Spawn Hotkey Manager
            let hotkey_manager = HotkeyManager::new(HOTKEY_BINDING.clone(), hk_tx);
            hotkey_manager.start_listening();

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
            get_current_state,
            get_current_model,
            unload_model,
            set_hotkey,
            models::list_local_models,
            models::download_model,
            models::delete_model,
            models::get_models_dir_path,
            llm::get_default_agents,
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
