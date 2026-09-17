pub mod app_info;
pub mod audio;
pub mod coordinator;
pub mod focus;
pub mod dictionary;
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

#[cfg(target_os = "linux")]
static SILENCE_LOCK: once_cell::sync::Lazy<std::sync::Mutex<()>> =
    once_cell::sync::Lazy::new(|| std::sync::Mutex::new(()));

#[cfg(target_os = "linux")]
pub fn silence_stderr<F, R>(f: F) -> R
where
    F: FnOnce() -> R,
{
    use std::os::unix::io::AsRawFd;
    struct RestoreFd(i32);
    impl Drop for RestoreFd {
        fn drop(&mut self) {
            if self.0 != -1 {
                unsafe {
                    libc::dup2(self.0, libc::STDERR_FILENO);
                    libc::close(self.0);
                }
            }
        }
    }
    let _g = SILENCE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let saved = unsafe { libc::dup(libc::STDERR_FILENO) };
    let _restore = RestoreFd(saved);
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
    f()
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

pub(crate) fn emit_history_changed() {
    if let Some(handle) = APP_HANDLE
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .cloned()
    {
        let _ = handle.emit("wisper:history-changed", ());
    }
}

static RECORDER: once_cell::sync::Lazy<std::sync::Mutex<Option<AudioRecorder>>> =
    once_cell::sync::Lazy::new(|| std::sync::Mutex::new(None));

static OVERLAY_ENABLED: once_cell::sync::Lazy<Mutex<bool>> =
    once_cell::sync::Lazy::new(|| Mutex::new(true));
static OVERLAY_POSITION: once_cell::sync::Lazy<Mutex<String>> =
    once_cell::sync::Lazy::new(|| Mutex::new("bottom".to_string()));
static OVERLAY_ERROR_ACTIVE: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

static OVERLAY_ERROR_REASON: once_cell::sync::Lazy<std::sync::Mutex<Option<String>>> =
    once_cell::sync::Lazy::new(|| std::sync::Mutex::new(None));

pub(crate) fn emit_overlay_origin(origin: Option<&crate::focus::OriginTarget>) {
    let Some(handle) = APP_HANDLE
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .cloned()
    else {
        return;
    };
    let json = match origin {
        Some(o) => serde_json::json!({
            "app_id": o.app_id,
            "title": o.title,
            "icon_data_url": o.icon_data_url,
        })
        .to_string(),
        None => "null".to_string(),
    };
    let h = handle.clone();
    let _ = handle.run_on_main_thread(move || {
        if let Some(win) = h.get_webview_window(OVERLAY_LABEL) {
            let _ = win.eval(&format!("window.__origin && window.__origin({json})"));
        }
    });
}

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
fn start_mic_preview(device: Option<String>) -> Result<(), String> {
    let device = match device {
        Some(d) if !d.is_empty() => Some(d),
        _ => {
            let g = crate::coordinator::INPUT_DEVICE
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .clone();
            if g.is_empty() { None } else { Some(g) }
        }
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
fn test_paste() -> Result<(), String> {
    let method = crate::coordinator::PASTE_METHOD
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    let method = if method.is_empty() { "auto".to_string() } else { method };
    crate::paste::paste_text("The quick brown fox 123", &method)
}

#[tauri::command]
fn hide_main_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("main") {
        win.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
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
fn get_origin_environment() -> focus::OriginEnvironment {
    focus::get_origin_environment()
}

#[tauri::command]
fn ensure_gnome_extension() -> Result<focus::OriginEnvironment, String> {
    focus::ensure_gnome_extension()
}

#[tauri::command]
fn cancel_recording() {
    coordinator::cancel_all();
}

#[tauri::command]
fn get_current_state() -> String {
    let state = STATE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    match *state {
        CoordinatorState::Idle => {
            if crate::coordinator::active_job_count() > 0 {
                "processing".into()
            } else {
                "idle".into()
            }
        }
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

const OVERLAY_LABEL: &str = "wisper-overlay";
const OVERLAY_WIDTH: f64 = 294.0;
const OVERLAY_HEIGHT: f64 = 46.0;
const OVERLAY_TOP_OFFSET: f64 = 0.0;
const OVERLAY_BOTTOM_OFFSET: f64 = 0.0;

#[cfg(target_os = "linux")]
use enigo::Mouse;

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

fn monitor_with_cursor(app: &tauri::AppHandle) -> Option<tauri::Monitor> {
    let tauri_pos = app
        .cursor_position()
        .ok()
        .map(|p| (p.x as i32, p.y as i32));
    let enigo_pos = cursor_pos();

    let cursor = match (tauri_pos, enigo_pos) {
        (Some(tp), Some(ep)) => {
            if tp == (0, 0) && ep != (0, 0) {
                Some(ep)
            } else if ep == (0, 0) && tp != (0, 0) {
                Some(tp)
            } else {
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
            for m in &monitors {
                let p = m.position();
                let s = m.size();
                if mx >= p.x && mx < p.x + s.width as i32 && my >= p.y && my < p.y + s.height as i32
                {
                    return Some(m.clone());
                }
            }
            eprintln!(
                "[overlay] cursor ({},{}) not in any monitor, monitors={:?}",
                mx,
                my,
                monitors
                    .iter()
                    .map(|m| (m.position().x, m.position().y, m.size().width, m.size().height))
                    .collect::<Vec<_>>()
            );
        }
    } else {
        eprintln!("[overlay] no cursor pos: tauri={:?} enigo={:?}", tauri_pos, enigo_pos);
    }
    app.primary_monitor().ok().flatten()
}

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
            .shadow(false)
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

static LAST_OVERLAY_POS: once_cell::sync::Lazy<std::sync::Mutex<Option<(f64, f64)>>> =
    once_cell::sync::Lazy::new(|| std::sync::Mutex::new(None));

#[cfg(target_os = "windows")]
fn windows_work_area_for_cursor(app: &tauri::AppHandle) -> Option<(i32, i32, i32, i32)> {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromPoint, MONITORINFO, MONITORINFOEXW, MONITOR_DEFAULTTONEAREST,
    };
    let pos = app.cursor_position().ok()?;
    let pt = POINT {
        x: pos.x as i32,
        y: pos.y as i32,
    };
    let hmon = unsafe { MonitorFromPoint(pt, MONITOR_DEFAULTTONEAREST) };
    if hmon.is_invalid() {
        return None;
    }
    let mut info: MONITORINFOEXW = unsafe { std::mem::zeroed() };
    info.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;
    let ok = unsafe { GetMonitorInfoW(hmon, &mut info.monitorInfo as *mut MONITORINFO) };
    if !ok.as_bool() {
        return None;
    }
    let r = info.monitorInfo.rcWork;
    Some((r.left, r.top, r.right, r.bottom))
}

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
    #[cfg(target_os = "windows")]
    let (mx, my, mw, mh) = match windows_work_area_for_cursor(app) {
        Some((l, t, r, b)) => (
            l as f64 / scale,
            t as f64 / scale,
            (r - l) as f64 / scale,
            (b - t) as f64 / scale,
        ),
        None => (
            monitor.position().x as f64 / scale,
            monitor.position().y as f64 / scale,
            monitor.size().width as f64 / scale,
            monitor.size().height as f64 / scale,
        ),
    };
    #[cfg(not(target_os = "windows"))]
    let (mx, my, mw, mh) = (
        monitor.position().x as f64 / scale,
        monitor.position().y as f64 / scale,
        monitor.size().width as f64 / scale,
        monitor.size().height as f64 / scale,
    );
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

fn update_overlay(app: &tauri::AppHandle, state: CoordinatorState) {
    let app_clone = app.clone();
    let _ = app.run_on_main_thread(move || {
        let app = &app_clone;
        let Some(win) = app.get_webview_window(OVERLAY_LABEL) else {
            if *OVERLAY_ENABLED.lock().unwrap_or_else(|e| e.into_inner()) {
                create_overlay(app);
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
                if OVERLAY_ERROR_ACTIVE.load(std::sync::atomic::Ordering::SeqCst) {
                    return;
                }
                if crate::coordinator::active_job_count() > 0 {
                    let _ = win.eval("window.__mode && window.__mode('processing')");
                } else {
                    #[cfg(target_os = "windows")]
                    {
                        let _ = win.eval("window.__mode && window.__mode('idle')");
                        let _ = win.hide();
                    }
                    #[cfg(not(target_os = "windows"))]
                    {
                        let _ = win.destroy();
                    }
                }
            }
            CoordinatorState::Recording | CoordinatorState::Processing => {
                OVERLAY_ERROR_ACTIVE.store(false, std::sync::atomic::Ordering::SeqCst);
                *OVERLAY_ERROR_REASON
                    .lock()
                    .unwrap_or_else(|e| e.into_inner()) = None;
                let _ = win.eval("window.__mode && window.__mode('recording')");
                let _ = win.show();
                if let Some((x, y)) = overlay_pos_for(app, false, OVERLAY_WIDTH, OVERLAY_HEIGHT) {
                    let _ = win.set_position(tauri::LogicalPosition::new(x, y));
                }
            }
            CoordinatorState::Error => {
                let reason = OVERLAY_ERROR_REASON
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .clone();
                let reason_json = serde_json::to_string(&reason).unwrap_or_else(|_| "null".into());
                let _ = win.eval(&format!(
                    "window.__errReason = {reason_json}; window.__mode && window.__mode('error', {reason_json})"
                ));
                let _ = win.show();
                if let Some((x, y)) =
                    overlay_pos_for(app, false, OVERLAY_WIDTH, OVERLAY_HEIGHT)
                {
                    let _ = win.set_position(tauri::LogicalPosition::new(x, y));
                }
            }
        }
    });
}

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
            let _ = win.eval("window.__mode && window.__mode('idle')");
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
    OVERLAY_ERROR_ACTIVE.store(true, std::sync::atomic::Ordering::SeqCst);
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
            OVERLAY_ERROR_ACTIVE.store(false, std::sync::atomic::Ordering::SeqCst);
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
            crate::tray::refresh_with(&saved_settings);
            #[cfg(target_os = "windows")]
            {
                let prewarm_handle = app_handle.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(3));
                    let inner = prewarm_handle.clone();
                    let _ = prewarm_handle.run_on_main_thread(move || {
                        create_overlay(&inner);
                    });
                });
            }
            if saved_settings.max_history_entries > 0 {
                let max = saved_settings.max_history_entries as i64;
                let mode = if saved_settings.keep_recordings
                    && saved_settings.history_retention_mode == "recordings_only"
                {
                    "recordings_only"
                } else {
                    "both"
                };
                std::thread::spawn(move || {
                    let _ = crate::history::HistoryManager::new().trim_history(max, mode);
                    let _ = crate::history::HistoryManager::new().delete_zero_word_entries();
                });
            } else {
                std::thread::spawn(move || {
                    let _ = crate::history::HistoryManager::new().delete_zero_word_entries();
                });
            }

            if saved_settings.autostart {
                let _ = app.autolaunch().enable();
            } else {
                let _ = app.autolaunch().disable();
            }

            #[cfg(target_os = "linux")]
            {
                let handle = app_handle.clone();
                std::thread::spawn(move || {
                        if let Ok(session) = std::env::var("XDG_SESSION_TYPE") {
                            if session.to_lowercase() != "wayland" {
                                return;
                            }
                        } else if std::env::var("WAYLAND_DISPLAY").is_err() {
                            return;
                        }
                        let Ok(ver_out) = std::process::Command::new("gnome-shell")
                            .arg("--version")
                            .output()
                        else {
                            return;
                        };
                        let ver = String::from_utf8_lossy(&ver_out.stdout).to_lowercase();
                        if !ver.contains("gnome shell") {
                            return;
                        }
                        let Some(home) = dirs::home_dir() else { return };
                        let ext_dir = home.join(".local/share/gnome-shell/extensions/wisper-focus@wisper.app");
                        let src_dir = std::path::PathBuf::from("/usr/share/gnome-shell/extensions/wisper-focus@wisper.app");
                        let mut bundled: Option<std::path::PathBuf> = None;
                        if let Ok(res) = handle.path().resource_dir() {
                            let cand = res.join("resources/gnome-shell/wisper-focus@wisper.app");
                            if cand.join("extension.js").is_file() {
                                bundled = Some(cand);
                            }
                            let cand2 = res.join("gnome-shell/wisper-focus@wisper.app");
                            if bundled.is_none() && cand2.join("extension.js").is_file() {
                                bundled = Some(cand2);
                            }
                        }
                        if bundled.is_none() {
                            for cand in [
                                std::path::PathBuf::from("/usr/lib/wisper/resources/gnome-shell/wisper-focus@wisper.app"),
                                std::path::PathBuf::from("/usr/share/wisper/resources/gnome-shell/wisper-focus@wisper.app"),
                            ] {
                                if cand.join("extension.js").is_file() {
                                    bundled = Some(cand);
                                    break;
                                }
                            }
                        }
                        let Some(bundled) = bundled else { return };
                        let need_copy = match std::fs::read_to_string(ext_dir.join("extension.js")) {
                            Ok(cur) => std::fs::read_to_string(bundled.join("extension.js"))
                                .map(|s| s != cur)
                                .unwrap_or(true),
                            Err(_) => true,
                        };
                        if !need_copy {
                            return;
                        }
                        let _ = std::fs::create_dir_all(&ext_dir);
                        for name in ["extension.js", "metadata.json"] {
                            if let Ok(data) = std::fs::read(bundled.join(name)) {
                                let _ = std::fs::write(ext_dir.join(name), data);
                            }
                        }
                        let _ = std::process::Command::new("gsettings")
                            .args([
                                "set",
                                "org.gnome.shell",
                                "enabled-extensions",
                                &{
                                    let out = std::process::Command::new("gsettings")
                                        .args(["get", "org.gnome.shell", "enabled-extensions"])
                                        .output()
                                        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
                                        .unwrap_or_default();
                                    if out.contains("wisper-focus@wisper.app") {
                                        out
                                    } else {
                                        let trimmed = out.trim();
                                        if trimmed.starts_with('[') && trimmed.ends_with(']') {
                                            let inner = trimmed[1..trimmed.len()-1].trim();
                                            if inner.is_empty() {
                                                "['wisper-focus@wisper.app']".to_string()
                                            } else {
                                                format!("[{}, 'wisper-focus@wisper.app']", inner)
                                            }
                                        } else {
                                            "['wisper-focus@wisper.app']".to_string()
                                        }
                                    }
                                },
                            ])
                            .output();
                        let _ = std::process::Command::new("gnome-extensions")
                            .args(["enable", "wisper-focus@wisper.app"])
                            .output();
                        let _ = src_dir;
                });
            }

            if saved_settings.launch_to_tray {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.hide();
                }
            } else if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.set_focus();
            }

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
                if window.label() == "main" {
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_app_version,
            get_paste_environment,
            get_origin_environment,
            ensure_gnome_extension,
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
            dictionary::list_bundled_profiles,
            dictionary::list_imported_profiles,
            dictionary::import_bundled_profile,
            dictionary::import_profile_from_json,
            dictionary::import_profile_from_url,
            dictionary::set_profile_active,
            dictionary::remove_profile,
            dictionary::export_profile,
            dictionary::export_user_words,
            dictionary::check_profile_updates,
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
            list_audio_devices,
            test_paste,
            hide_main_window,
            quit_app
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|e| {
            eprintln!("error while running tauri application: {}", e);
            std::process::exit(1);
        });
}
