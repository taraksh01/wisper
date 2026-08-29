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
pub mod whisper_keys;
pub mod words;

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
#[cfg(target_os = "linux")]
static SILENCE_LOCK: once_cell::sync::Lazy<std::sync::Mutex<()>> =
    once_cell::sync::Lazy::new(|| std::sync::Mutex::new(()));

#[cfg(target_os = "linux")]
pub fn silence_stderr<F, R>(f: F) -> R
where
    F: FnOnce() -> R,
{
    use std::os::unix::io::AsRawFd;
    let _g = SILENCE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
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

pub(crate) static APP_HANDLE: once_cell::sync::Lazy<Mutex<Option<tauri::AppHandle>>> =
    once_cell::sync::Lazy::new(|| Mutex::new(None));

pub(crate) fn emit_settings_changed(settings: &crate::settings::AppSettings) {
    if let Some(handle) = APP_HANDLE
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .cloned()
    {
        let _ = handle.emit("wisper:settings-changed", settings);
    }
}

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

// The human-readable reason shown in the error overlay's pill.
static OVERLAY_ERROR_REASON: once_cell::sync::Lazy<std::sync::Mutex<Option<String>>> =
    once_cell::sync::Lazy::new(|| std::sync::Mutex::new(None));

#[tauri::command]
fn get_input_level() -> f32 {
    RECORDER
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .map(|r| r.current_level())
        .unwrap_or(0.0)
}

#[tauri::command]
fn start_mic_preview() -> Result<(), String> {
    let device = crate::coordinator::INPUT_DEVICE
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    let device = if device.is_empty() {
        None
    } else {
        Some(device)
    };
    RECORDER
        .lock()
        .unwrap_or_else(|e| e.into_inner())
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
fn cancel_recording() {
    coordinator::cancel_all();
}

#[tauri::command]
fn get_current_state() -> String {
    let state = STATE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    match *state {
        CoordinatorState::Idle => "idle".into(),
        CoordinatorState::Recording => "recording".into(),
        CoordinatorState::Processing => "processing".into(),
        CoordinatorState::Error => "error".into(),
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
    coordinator::MODEL_DISPLAY_NAME
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
}

#[tauri::command]
fn unload_model(app: tauri::AppHandle) {
    let mode = coordinator::ENGINE_MODE
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
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
        CoordinatorState::Idle => {
            if crate::coordinator::active_job_count() > 0 {
                "processing"
            } else {
                "idle"
            }
        }
        CoordinatorState::Recording => "recording",
        CoordinatorState::Processing => "processing",
        CoordinatorState::Error => "error",
    };
    let _ = app.emit("wisper:state", label);
    update_overlay(app, state);
}

/// Detached overlay window: a transparent, decoration-less, non-focusable
/// Tauri webview showing the recording indicator (public/overlay.html).
/// Created hidden, shown during recording/processing, destroyed when idle.
const OVERLAY_LABEL: &str = "wisper-overlay";
const OVERLAY_WIDTH: f64 = 172.0;
const OVERLAY_HEIGHT: f64 = 60.0;
const OVERLAY_TOP_OFFSET: f64 = 0.0;
const OVERLAY_BOTTOM_OFFSET: f64 = 0.0;

#[cfg(target_os = "linux")]
use enigo::Mouse;

/// Cursor position fallback. On Wayland, Tauri's cursor_position() can return
/// (0,0), so ask enigo (which talks to the compositor) for the real pointer
/// location. On other platforms Tauri's cursor_position() is reliable, so we
/// just return None and rely on it directly.
fn cursor_pos() -> Option<(i32, i32)> {
    #[cfg(target_os = "linux")]
    {
        enigo::Enigo::new(&enigo::Settings::default())
            .ok()
            .and_then(|e| e.location().ok())
    }
    #[cfg(not(target_os = "linux"))]
    {
        None
    }
}

/// Resolves the monitor the cursor is currently on, using Tauri's
/// cursor_position() (cross-platform) with an enigo fallback on Linux/Wayland,
/// then the primary monitor as a last resort.
///
/// Wayland bug: `cursor_position()` often returns `Ok(0,0)` instead of `Err`,
/// so `or_else` never fires and we always pick the primary monitor. We must
/// detect that case and prefer Enigo when it yields a different non-zero point.
fn monitor_with_cursor(app: &tauri::AppHandle) -> Option<tauri::Monitor> {
    let tauri_pos = app
        .cursor_position()
        .ok()
        .map(|p| (p.x as i32, p.y as i32));
    let enigo_pos = cursor_pos();

    // Prefer a non-zero Enigo result on Linux; if both are present and differ,
    // the Enigo value is the Wayland-correct one. Otherwise use whichever is Some.
    let cursor = match (tauri_pos, enigo_pos) {
        (Some(tp), Some(ep)) => {
            // If Tauri says (0,0) but Enigo disagrees, trust Enigo.
            if tp == (0, 0) && ep != (0, 0) {
                Some(ep)
            } else if ep == (0, 0) && tp != (0, 0) {
                Some(tp)
            } else {
                // Both non-zero and disagree — Enigo is more reliable on X11/Wayland.
                #[cfg(target_os = "linux")]
                { Some(ep) }
                #[cfg(not(target_os = "linux"))]
                { Some(tp) }
            }
        }
        (Some(p), None) | (None, Some(p)) => Some(p),
        (None, None) => None,
    };

    if let Some((mx, my)) = cursor {
        if let Ok(monitors) = app.available_monitors() {
            for m in monitors {
                let p = m.position();
                let s = m.size();
                if mx >= p.x && mx < p.x + s.width as i32 && my >= p.y && my < p.y + s.height as i32
                {
                    return Some(m);
                }
            }
            eprintln!(
                "[overlay] cursor ({},{}) not in any monitor, monitors={:?}",
                mx,
                my,
                app.available_monitors()
                    .ok()
                    .map(|v| v
                        .iter()
                        .map(|m| (m.position().x, m.position().y, m.size().width, m.size().height))
                        .collect::<Vec<_>>())
            );
        }
    } else {
        eprintln!("[overlay] no cursor pos: tauri={:?} enigo={:?}", tauri_pos, enigo_pos);
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
    let pos = overlay_pos_for(app, false, OVERLAY_WIDTH, OVERLAY_HEIGHT);
    let mut builder =
        tauri::WebviewWindowBuilder::new(app, OVERLAY_LABEL, tauri::WebviewUrl::App(url.into()))
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
    if let Some((x, y)) = pos {
        builder = builder.position(x, y);
    }
    match builder.build() {
        Ok(win) => {
            let _ = win.hide();
            let pos = OVERLAY_POSITION
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .clone();
            let _ = win.eval(&format!(
                "window.__setPosition && window.__setPosition('{}')",
                pos
            ));
        }
        Err(e) => {
            eprintln!("create_overlay: BUILD FAILED: {}", e);
        }
    }
}

/// Last computed overlay position (logical px). Cached during the recording/
/// processing phase so the error overlay can reuse it and never drift to the
/// window-manager's default (centered) placement when the window is recreated.
static LAST_OVERLAY_POS: once_cell::sync::Lazy<std::sync::Mutex<Option<(f64, f64)>>> =
    once_cell::sync::Lazy::new(|| std::sync::Mutex::new(None));

/// Computes the overlay's (x, y) logical position for a window of the given
/// size. When `prefer_cache` is true it reuses the last recording position (so
/// an error/recreated window stays put); otherwise it tracks the live cursor
/// monitor and caches the result so the error state can reuse it. `win_w`/
/// `win_h` are the window's ACTUAL size (read from the live window) so the
/// bottom-center math stays correct even if the HTML/content size differs from
/// the `OVERLAY_*` constants.
fn overlay_pos_for(
    app: &tauri::AppHandle,
    prefer_cache: bool,
    win_w: f64,
    win_h: f64,
) -> Option<(f64, f64)> {
    let top = *OVERLAY_POSITION.lock().unwrap_or_else(|e| e.into_inner()) == "top";
    let cached = LAST_OVERLAY_POS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    let pos = if prefer_cache { cached } else { None };
    if let Some(p) = pos {
        return Some(p);
    }
    let monitor = monitor_with_cursor(app)?;
    let scale = monitor.scale_factor();
    let mx = monitor.position().x as f64 / scale;
    let my = monitor.position().y as f64 / scale;
    let mw = monitor.size().width as f64 / scale;
    let mh = monitor.size().height as f64 / scale;
    let x = mx + (mw - win_w) / 2.0;
    let y = if top {
        my + OVERLAY_TOP_OFFSET
    } else {
        my + mh - win_h - OVERLAY_BOTTOM_OFFSET
    };
    let p = (x, y);
    if !prefer_cache {
        *LAST_OVERLAY_POS
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = Some(p);
    }
    Some(p)
}

/// Positions the overlay. `set_position` is called AFTER `show` because on
/// X11/Wayland a position set on a not-yet-mapped window is ignored by the WM
/// and overridden to the default (centered) at map time — the root cause of the
/// position drift. Uses the window's real size. Must be called on the main thread.
fn position_overlay(app: &tauri::AppHandle, win: &tauri::WebviewWindow, prefer_cache: bool) {
    // Use the window's own scale factor for correct physical→logical conversion;
    // fall back to cursor monitor's scale only if the window query fails (e.g. not yet mapped).
    let scale = win.scale_factor().unwrap_or_else(|_| {
        monitor_with_cursor(app)
            .or_else(|| app.primary_monitor().ok().flatten())
            .as_ref()
            .map(|m| m.scale_factor())
            .unwrap_or(1.0)
    });
    let (win_w, win_h) = match win.inner_size() {
        Ok(phys) => {
            let logical = phys.to_logical::<f64>(scale);
            let w = logical.width;
            let h = logical.height;
            if w <= 0.0 || h <= 0.0 {
                (OVERLAY_WIDTH, OVERLAY_HEIGHT)
            } else {
                (w, h)
            }
        }
        Err(_) => (OVERLAY_WIDTH, OVERLAY_HEIGHT),
    };
    if let Some((x, y)) = overlay_pos_for(app, prefer_cache, win_w, win_h) {
        let _ = win.set_position(tauri::LogicalPosition::new(x, y));
    }
}

/// Show/hide the overlay, mirroring Handy's show_overlay_state positioning.
/// Window ops must run on the main thread in Tauri v2, so the whole body is
/// dispatched there. Running off-thread (e.g. from the state-listener thread)
/// silently no-ops set_position/show/destroy and the window falls back to
/// Tauri's default centered placement — the recurring position-drift bug.
fn update_overlay(app: &tauri::AppHandle, state: CoordinatorState) {
    let app_clone = app.clone();
    let _ = app.run_on_main_thread(move || {
        let app = &app_clone;
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
                if crate::coordinator::active_job_count() > 0 {
                    let _ = win.eval("window.__mode && window.__mode('processing')");
                } else {
                    let _ = win.destroy();
                }
            }
            CoordinatorState::Recording | CoordinatorState::Processing => {
                let _ = win.eval("window.__mode && window.__mode('recording')");
                let _ = win.show();
                position_overlay(app, &win, false);
            }
            CoordinatorState::Error => {
                // Error reuses the live window and keeps the exact recording
                // position (cached) so it never drifts if the window is recreated.
                let reason = OVERLAY_ERROR_REASON
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .clone();
                let reason_json = serde_json::to_string(&reason).unwrap_or_else(|_| "null".into());
                let _ = win.eval(&format!(
                    "window.__errReason = {reason_json}; window.__mode && window.__mode('error', {reason_json})"
                ));
                let _ = win.show();
                position_overlay(app, &win, true);
            }
        }
    });
}

/// Hide the overlay window (used before pasting so keyboard focus
/// returns to the target app instead of the overlay).
pub fn hide_overlay() {
    let Some(handle) = APP_HANDLE
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .cloned()
    else {
        return;
    };
    let hide_handle = handle.clone();
    let _ = handle.run_on_main_thread(move || {
        if let Some(win) = hide_handle.get_webview_window(OVERLAY_LABEL) {
            let _ = win.hide();
        }
    });
}

pub fn is_overlay_visible() -> bool {
    let Some(handle) = APP_HANDLE
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .cloned()
    else {
        return false;
    };
    handle
        .get_webview_window(OVERLAY_LABEL)
        .map(|w| w.is_visible().unwrap_or(false))
        .unwrap_or(false)
}

/// Briefly flash the overlay error state (~1.5s) to signal a failed
/// transcription, showing `reason` (if any) in a pill. The window is destroyed
/// afterwards so it can never get stuck in the error state.
pub fn show_overlay_error(reason: Option<String>) {
    let Some(handle) = APP_HANDLE
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .cloned()
    else {
        return;
    };
    if !*OVERLAY_ENABLED.lock().unwrap_or_else(|e| e.into_inner()) {
        return;
    }
    OVERLAY_ERROR_ACTIVE.store(true, std::sync::atomic::Ordering::Relaxed);
    *OVERLAY_ERROR_REASON
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = reason;
    {
        let mut lock = crate::tray::STATE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        *lock = CoordinatorState::Error;
    }
    emit_state(&handle, CoordinatorState::Error);
    let handle_clone = handle.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(1500));
        let h = handle_clone.clone();
        let _ = handle_clone.run_on_main_thread(move || {
            OVERLAY_ERROR_ACTIVE.store(false, std::sync::atomic::Ordering::Relaxed);
            *OVERLAY_ERROR_REASON
                .lock()
                .unwrap_or_else(|e| e.into_inner()) = None;
            let still_error = {
                let mut lock = crate::tray::STATE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
                if *lock == CoordinatorState::Error {
                    *lock = CoordinatorState::Idle;
                    true
                } else {
                    false
                }
            };
            if still_error {
                emit_state(&h, CoordinatorState::Idle);
            }
        });
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "linux")]
    if std::env::var_os("GDK_BACKEND").is_none() {
        std::env::set_var("GDK_BACKEND", "x11");
    }
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

            let tray: Option<tauri::tray::TrayIcon> =
                match crate::tray::build_tray(&app_handle.clone()) {
                    Ok(t) => Some(t),
                    Err(e) => {
                        eprintln!("Tray build failed (running without tray): {}", e);
                        None
                    }
                };

            let (cmd_tx, cmd_rx) = mpsc::channel();
            let (state_tx, state_rx) = mpsc::channel();
            // Overlay ✕ / Escape land here (see coordinator::send_cancel)
            coordinator::set_cancel_sender(cmd_tx.clone());

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

            let mut saved_settings = settings::AppSettings::load();
            if saved_settings.lifetime_dictations == 0 && saved_settings.lifetime_words == 0 {
                if let Ok((total, total_words, _)) =
                    crate::history::HistoryManager::new().get_stats()
                {
                    if total > 0 {
                        saved_settings.lifetime_dictations = total;
                        saved_settings.lifetime_words = total_words;
                        let _ = saved_settings.save();
                    }
                }
            }
            settings::sync_runtime(&saved_settings);
            crate::tray::refresh();
            // Enforce history retention limit on startup
            if saved_settings.max_history_entries > 0 {
                let mode = if saved_settings.keep_recordings
                    && saved_settings.history_retention_mode == "recordings_only"
                {
                    "recordings_only"
                } else {
                    "both"
                };
                let _ = crate::history::HistoryManager::new()
                    .trim_history(saved_settings.max_history_entries as i64, mode);
            }
            // Clean up previously saved zero-word entries (polluted history)
            let _ = crate::history::HistoryManager::new().delete_zero_word_entries();

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

            // Fixed window, but auto-scale for larger displays (e.g. 2K/4K)
            // so the UI doesn't look tiny on HiDPI/large monitors. Window is
            // `resizable: false` (user can't drag), but we set a resolution-
            // aware size at startup. Base 900x700 is designed for 1920x1080
            // logical; scale is min(width/1920, height/1080) capped 1.0..1.5.
            if let Some(win) = app.get_webview_window("main") {
                let scale = win.scale_factor().unwrap_or(1.0);
                let mon = win
                    .current_monitor()
                    .ok()
                    .flatten()
                    .or_else(|| win.primary_monitor().ok().flatten());
                if let Some(m) = mon {
                    let logical_w = m.size().width as f64 / scale;
                    let logical_h = m.size().height as f64 / scale;
                    let scale_w = logical_w / 1920.0;
                    let scale_h = logical_h / 1080.0;
                    let auto = scale_w.min(scale_h).clamp(1.0, 1.5);
                    let target_w = (900.0 * auto).round();
                    let target_h = (700.0 * auto).round();
                    let max_w = (logical_w - 24.0).max(900.0);
                    let max_h = (logical_h - 96.0).max(700.0);
                    let final_w = target_w.min(max_w);
                    let final_h = target_h.min(max_h);
                    if (final_w - 900.0).abs() > 0.5 || (final_h - 700.0).abs() > 0.5 {
                        let _ = win.set_size(tauri::LogicalSize::new(final_w, final_h));
                        let _ = win.center();
                    }
                }
            }

            let recorder = AudioRecorder::new();
            {
                let mut guard = RECORDER.lock().unwrap_or_else(|e| e.into_inner());
                *guard = Some(recorder.clone());
            }
            let coordinator = TranscriptionCoordinator::new(recorder, cmd_rx, Some(state_tx));

            // Spawn Coordinator
            if let Err(e) = thread::Builder::new()
                .stack_size(8 * 1024 * 1024)
                .spawn(move || {
                    coordinator.run();
                })
            {
                eprintln!("Failed to spawn coordinator thread: {}", e);
                return Err(Box::new(std::io::Error::new(
                    std::io::ErrorKind::Other,
                    format!("Failed to spawn coordinator: {}", e),
                )));
            }

            // Register the global hotkey via whisper-keys (raw input hook:
            // works uniformly across X11/Wayland and every focused app).
            whisper_keys::init(&app.handle());
            create_overlay(&app.handle());
            let saved = &saved_settings.hotkey;
            if whisper_keys::register(saved).is_err() && saved != DEFAULT_HOTKEY {
                eprintln!(
                    "Hotkey {:?} failed to register; using default {:?}",
                    saved, DEFAULT_HOTKEY
                );
                if let Err(e2) = whisper_keys::register(DEFAULT_HOTKEY) {
                    eprintln!("Failed to register default hotkey: {}", e2);
                }
            }

            // Spawn State Listener -> Tray + State Lock + Frontend Events
            let app_handle_clone = app_handle.clone();
            thread::spawn(move || {
                while let Ok(state) = state_rx.recv() {
                    let model_name = coordinator::MODEL_DISPLAY_NAME
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .clone();
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
                        CoordinatorState::Error => format!("{} - Error", dn),
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
            cancel_recording,
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
            process::test_process_connection,
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
        .unwrap_or_else(|e| {
            eprintln!("error while running tauri application: {}", e);
            std::process::exit(1);
        });
}
