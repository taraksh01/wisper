pub mod app_info;
pub mod audio;
pub mod coordinator;
pub mod engine;
pub mod history;
pub mod hotkey;
pub mod models;
pub mod paste;
pub mod process;
pub mod settings;
pub mod tray;
pub mod words;
pub mod whisper_keys;

use audio::AudioRecorder;
use coordinator::{CoordinatorCommand, CoordinatorState, TranscriptionCoordinator};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;

const DEFAULT_HOTKEY: &str = "F9";

/// Temporarily silence C-level stderr (fd 2) around a closure.
///
/// Some native libraries (libayatana-appindicator, handy-keys) print harmless
/// deprecation/info warnings straight to the C stderr stream, which can't be
/// captured by Rust's `eprintln!` redirection. This dup2's fd 2 to /dev/null
/// for the duration of `f`, then restores the original fd. Linux only.
#[cfg(target_os = "linux")]
pub fn silence_stderr<F, R>(f: F) -> R
where
    F: FnOnce() -> R,
{
    use std::os::unix::io::AsRawFd;
    // Save the current stderr fd.
    let saved = unsafe { libc::dup(libc::STDERR_FILENO) };
    let null = std::fs::OpenOptions::new()
        .write(true)
        .open("/dev/null")
        .ok();
    if saved != -1 {
        if let Some(ref n) = null {
            unsafe {
                libc::dup2(n.as_raw_fd(), libc::STDERR_FILENO);
            }
        }
    }
    let result = f();
    if saved != -1 {
        unsafe {
            libc::dup2(saved, libc::STDERR_FILENO);
            libc::close(saved);
        }
    }
    result
}

use tauri::{Emitter, Manager, WindowEvent};
use tauri_plugin_autostart::ManagerExt;

use crate::tray::STATE_LOCK;

type HotkeySender = Arc<Mutex<mpsc::Sender<hotkey::HotkeyEvent>>>;
static HOTKEY_SENDER: once_cell::sync::Lazy<Mutex<Option<HotkeySender>>> =
    once_cell::sync::Lazy::new(|| Mutex::new(None));

/// Handle for overlay-window operations (owned by lib, not tray).
static APP_HANDLE: once_cell::sync::Lazy<Mutex<Option<tauri::AppHandle>>> =
    once_cell::sync::Lazy::new(|| Mutex::new(None));

static RECORDER: once_cell::sync::Lazy<std::sync::Mutex<Option<AudioRecorder>>> =
    once_cell::sync::Lazy::new(|| std::sync::Mutex::new(None));

static OVERLAY_ENABLED: once_cell::sync::Lazy<Mutex<bool>> =
    once_cell::sync::Lazy::new(|| Mutex::new(true));
static OVERLAY_POSITION: once_cell::sync::Lazy<Mutex<String>> =
    once_cell::sync::Lazy::new(|| Mutex::new("bottom".to_string()));
// Set while the error glyph is flashing so the Idle handler doesn't destroy
// the window before the flash finishes (the error thread clears it).
static OVERLAY_ERROR_ACTIVE: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

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
fn start_mic_preview() -> Result<(), String> {
    let device = crate::coordinator::INPUT_DEVICE.lock().unwrap_or_else(|e| e.into_inner()).clone();
    let device = if device.is_empty() { None } else { Some(device) };
    RECORDER
        .lock()
        .unwrap()
        .as_ref()
        .map(|r| r.start_preview(device))
        .unwrap_or(Err("Recorder not initialized".into()))
}

#[tauri::command]
fn list_audio_devices() -> Vec<(String, String)> {
    crate::audio::list_input_devices()
}

#[tauri::command]
fn stop_mic_preview() {
    if let Some(r) = RECORDER.lock().unwrap_or_else(|e| e.into_inner()).as_ref() {
        r.stop_preview();
    }
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
    let state = STATE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    match *state {
        CoordinatorState::Idle => "idle".into(),
        CoordinatorState::Recording => "recording".into(),
        CoordinatorState::Processing => "processing".into(),
    }
}

#[tauri::command]
fn set_hotkey(_app: tauri::AppHandle, key: String) -> Result<(), String> {
    let res = whisper_keys::register(&key);
    if res.is_ok() {
        settings::apply(&_app, |s| s.hotkey = key);
    }
    res
}

#[tauri::command]
fn get_current_model() -> String {
    coordinator::MODEL_DISPLAY_NAME.lock().unwrap_or_else(|e| e.into_inner()).clone()
}

#[tauri::command]
fn unload_model(app: tauri::AppHandle) {
    let mode = coordinator::ENGINE_MODE.lock().unwrap_or_else(|e| e.into_inner()).clone();
    if mode == "cloud" {
        if let Some(win) = app.get_webview_window("main") {
            let _ = win.show();
            let _ = win.set_focus();
        }
        let _ = app.emit("wisper:open-tab", "engine");
    } else {
        settings::unload_local_model(&app);
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
    create_overlay_with(app, crate::app_info::overlay_url());
}

fn create_overlay_with(app: &tauri::AppHandle, url: &str) {
    if app.get_webview_window(OVERLAY_LABEL).is_some() {
        return;
    }
    if !*OVERLAY_ENABLED.lock().unwrap_or_else(|e| e.into_inner()) {
        return;
    }
    let builder = tauri::WebviewWindowBuilder::new(app, OVERLAY_LABEL, tauri::WebviewUrl::App(url.into()))
        .title(crate::app_info::display_name())
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
        if *OVERLAY_ENABLED.lock().unwrap_or_else(|e| e.into_inner()) {
            create_overlay(app);
            // Guard against infinite recursion if build() failed (e.g. compositor rejects transparent window)
            if app.get_webview_window(OVERLAY_LABEL).is_some() {
                return update_overlay(app, state);
            }
        }
        return;
    };
    if !*OVERLAY_ENABLED.lock().unwrap_or_else(|e| e.into_inner()) {
        let _ = win.hide();
        return;
    }
    match state {
        CoordinatorState::Idle => {
            // Don't destroy while the error glyph is flashing — the error
            // thread owns that window and destroys it after ~1.5s.
            if OVERLAY_ERROR_ACTIVE.load(std::sync::atomic::Ordering::Relaxed) {
                return;
            }
            let _ = win.destroy();
        }
        CoordinatorState::Recording | CoordinatorState::Processing => {
            let top = *OVERLAY_POSITION.lock().unwrap_or_else(|e| e.into_inner()) == "top";
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
    if let Some(handle) = APP_HANDLE.lock().unwrap_or_else(|e| e.into_inner()).as_ref() {
        if let Some(win) = handle.get_webview_window(OVERLAY_LABEL) {
            let _ = win.hide();
        }
    }
}

/// Briefly flash the overlay error glyph (~1.5s) to signal a failed
/// transcription. The window is destroyed afterwards so it can never get
/// stuck in the error state; the next recording builds a fresh normal one.
pub fn show_overlay_error() {
    let Some(handle) = APP_HANDLE.lock().unwrap_or_else(|e| e.into_inner()).as_ref().cloned() else { return };
    if !*OVERLAY_ENABLED.lock().unwrap_or_else(|e| e.into_inner()) {
        return;
    }
    OVERLAY_ERROR_ACTIVE.store(true, std::sync::atomic::Ordering::Relaxed);
    // The overlay is already shown (we're in the Processing state when this
    // fires), so flash the live window instead of destroying + recreating —
    // Tauri's destroy is async and the recreate would early-return against the
    // still-present label, leaving a tombstone that never loads overlay.html.
    // Window ops must run on the main thread in Tauri v2, so eval/destroy both
    // go through run_on_main_thread; a plain OS thread only does the timing.
    let flash_handle = handle.clone();
    let _ = handle.run_on_main_thread(move || {
        if let Some(win) = flash_handle.get_webview_window(OVERLAY_LABEL) {
            let _ = win.eval("window.__mode && window.__mode('error')");
        }
    });
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(1500));
        let h = handle.clone();
        let _ = handle.run_on_main_thread(move || {
            OVERLAY_ERROR_ACTIVE.store(false, std::sync::atomic::Ordering::Relaxed);
            if let Some(win) = h.get_webview_window(OVERLAY_LABEL) {
                let _ = win.destroy();
            }
        });
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Dev desktop file is written in setup (needs app resource path), but we also
    // set GTK app_id via tauri's enableGTKAppId (identifier from merged config).
    // For `pnpm tauri dev` we merge tauri.dev.json via --config flag so identifier
    // becomes com.taraksh01.wisper-dev, which tao uses as Wayland app_id / X11 WM_CLASS.
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
                let mut guard = APP_HANDLE.lock().unwrap_or_else(|e| e.into_inner());
                *guard = Some(app_handle.clone());
            }

            let tray: Option<tauri::tray::TrayIcon> = match crate::tray::build_tray(&app_handle.clone()) {
                Ok(t) => Some(t),
                Err(e) => {
                    eprintln!("Tray build failed (running without tray): {}", e);
                    None
                }
            };

            let (cmd_tx, cmd_rx) = mpsc::channel();
            let (state_tx, state_rx) = mpsc::channel();

            let (hk_tx, hk_rx) = mpsc::channel();
            {
                let sender: HotkeySender = Arc::new(Mutex::new(hk_tx.clone()));
                *HOTKEY_SENDER.lock().unwrap_or_else(|e| e.into_inner()) = Some(sender);
            }
            thread::spawn(move || {
                while let Ok(event) = hk_rx.recv() {
                    let _ = cmd_tx.send(CoordinatorCommand::Hotkey(event));
                }
            });

    // Load saved settings and derive ALL runtime state from them (single source)
    let saved_settings = settings::AppSettings::load();
    settings::sync_runtime(&saved_settings);
    crate::tray::refresh();
    // Enforce history retention limit on startup
    if saved_settings.max_history_entries > 0 {
        let mode = if saved_settings.keep_recordings && saved_settings.history_retention_mode == "recordings_only" {
            "recordings_only"
        } else {
            "both"
        };
        let _ = crate::history::HistoryManager::new()
            .trim_history(saved_settings.max_history_entries as i64, mode);
    }

            if saved_settings.autostart {
                let _ = app.autolaunch().enable();
            } else {
                let _ = app.autolaunch().disable();
            }

            // Window visibility is user-controlled via General →
            // Startup → Launch to system tray (no `visible` in tauri.conf).
            if saved_settings.launch_to_tray {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.hide();
                }
            } else if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.set_focus();
            }

            let recorder = AudioRecorder::new();
            {
                let mut guard = RECORDER.lock().unwrap_or_else(|e| e.into_inner());
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
                    let model_name = coordinator::MODEL_DISPLAY_NAME.lock().unwrap_or_else(|e| e.into_inner()).clone();
                    let dn = crate::app_info::display_name();
                    let tooltip = match state {
                        CoordinatorState::Idle => {
                            if model_name.is_empty() {
                                format!("{} - Idle", dn)
                            } else {
                                format!("{} - Idle [{}]", dn, model_name)
                            }
                        }
                        CoordinatorState::Recording => format!("{} - Recording...", dn),
                        CoordinatorState::Processing => format!("{} - Processing...", dn),
                    };
                    if let Some(tray) = tray.as_ref() {
                        let _ = tray.set_tooltip(Some(&tooltip));
                    }
                    {
                        let mut lock = STATE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
                        *lock = state;
                    }
                    emit_state(&app_handle_clone, state);
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // Only intercept the main window; overlay is managed via destroy()
                if window.label() == "main" {
                    let _ = window.hide();
                    api.prevent_close();
                }
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
            models::cancel_download,
            models::install_model_assets,
            models::has_model_assets,
            process::get_agent_profiles,
            words::get_words,
            words::add_word_entry,
            words::update_word_entry,
            words::delete_word_entry,
            words::suggest_words,
            words::ignore_word_suggestion,
            words::get_ignored_terms,
            words::unignore_word_term,
            words::add_ignored_to_dictionary,
            history::get_history_entries,
            history::get_history_count,
            history::get_history_stats,
            history::delete_history_entry,
            history::update_history_entry,
            history::retranscribe_recording,
            history::get_recording_data,
            history::clear_history,
            settings::load_settings,
            settings::save_settings,
            settings::get_default_settings,
            start_mic_preview,
            stop_mic_preview,
            list_audio_devices
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
