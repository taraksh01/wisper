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
use rdev::Key;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WindowEvent,
};

static STATE_LOCK: once_cell::sync::Lazy<Arc<Mutex<CoordinatorState>>> =
    once_cell::sync::Lazy::new(|| Arc::new(Mutex::new(CoordinatorState::Idle)));

#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
fn get_current_state() -> String {
    let state = STATE_LOCK.lock().unwrap();
    format!("{:?}", *state)
}

fn emit_state(app: &tauri::AppHandle, state: CoordinatorState) {
    let label = match state {
        CoordinatorState::Idle => "idle",
        CoordinatorState::Recording => "recording",
        CoordinatorState::Processing => "processing",
    };
    let _ = app.emit("v3:state", label);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_handle = app.handle().clone();

            let quit_i = MenuItem::with_id(app, "quit", "Quit v3", true, None::<&str>)?;
            let settings_i =
                MenuItem::with_id(app, "settings", "Settings & History", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&settings_i, &quit_i])?;

            let tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .tooltip("v3 Dictation - Idle")
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

            let recorder = AudioRecorder::new();
            let coordinator =
                TranscriptionCoordinator::new(recorder, cmd_rx, Some(state_tx));

            // Spawn Coordinator
            thread::spawn(move || {
                coordinator.run();
            });

            // Spawn Hotkey Manager
            let hotkey_manager = HotkeyManager::new(Key::F12, hk_tx);
            hotkey_manager.start_listening();

            // Spawn State Listener -> Tray + State Lock + Frontend Events
            let app_handle_clone = app_handle.clone();
            thread::spawn(move || {
                while let Ok(state) = state_rx.recv() {
                    let tooltip = match state {
                        CoordinatorState::Idle => "v3 Dictation - Idle",
                        CoordinatorState::Recording => "v3 Dictation - Recording...",
                        CoordinatorState::Processing => "v3 Dictation - Processing...",
                    };
                    let _ = tray.set_tooltip(Some(tooltip));
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
            get_current_state,
            models::list_local_models,
            models::download_model,
            llm::get_default_agents,
            history::get_history_entries,
            history::get_history_stats,
            settings::load_settings,
            settings::save_settings
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}