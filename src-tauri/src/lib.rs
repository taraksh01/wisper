pub mod audio;
pub mod coordinator;
pub mod hotkey;

use audio::AudioRecorder;
use coordinator::{CoordinatorCommand, CoordinatorState, TranscriptionCoordinator};
use hotkey::HotkeyManager;
use rdev::Key;
use std::sync::mpsc;
use std::thread;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};

#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_handle = app.handle().clone();

            let quit_i = MenuItem::with_id(app, "quit", "Quit v3", true, None::<&str>)?;
            let settings_i = MenuItem::with_id(app, "settings", "Settings & History", true, None::<&str>)?;
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

            // Channels
            let (cmd_tx, cmd_rx) = mpsc::channel();
            let (state_tx, state_rx) = mpsc::channel();

            // Hotkey channel forwarding
            let (hk_tx, hk_rx) = mpsc::channel();
            thread::spawn(move || {
                while let Ok(event) = hk_rx.recv() {
                    let _ = cmd_tx.send(CoordinatorCommand::Hotkey(event));
                }
            });

            // Initialize Recorder and Coordinator
            let recorder = AudioRecorder::new();
            let coordinator = TranscriptionCoordinator::new(recorder, cmd_rx, Some(state_tx));

            // Spawn Coordinator
            thread::spawn(move || {
                coordinator.run();
            });

            // Spawn Hotkey Manager (default F12 for now)
            let hotkey_manager = HotkeyManager::new(Key::F12, hk_tx);
            hotkey_manager.start_listening();

            // Spawn State Listener to update Tray Icon
            thread::spawn(move || {
                while let Ok(state) = state_rx.recv() {
                    let tooltip = match state {
                        CoordinatorState::Idle => "v3 Dictation - Idle",
                        CoordinatorState::Recording => "v3 Dictation - Recording...",
                        CoordinatorState::Processing => "v3 Dictation - Processing...",
                    };
                    let _ = tray.set_tooltip(Some(tooltip));
                    
                    // We can also play sounds here or in coordinator directly.
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
        .invoke_handler(tauri::generate_handler![get_app_version])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
