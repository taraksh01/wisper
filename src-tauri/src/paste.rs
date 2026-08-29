use arboard::Clipboard;
use enigo::{Direction, Enigo, Key, Keyboard, Settings};
use once_cell::sync::Lazy;
use serde::Serialize;
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

static CMD_CACHE: Lazy<Mutex<std::collections::HashMap<String, (bool, std::time::Instant)>>> =
    Lazy::new(|| Mutex::new(std::collections::HashMap::new()));
const CMD_CACHE_TTL: Duration = Duration::from_secs(5);

/// Returns true if the given command is available on PATH.
/// Results are cached for 5s to avoid spawning `which` on every paste.
fn command_exists(tool: &str) -> bool {
    // Use `which`-style lookup without shell to avoid injection
    if tool.contains('/') || tool.contains(';') || tool.contains('&') || tool.contains('|') {
        return false;
    }
    {
        let cache = CMD_CACHE.lock().unwrap_or_else(|e| e.into_inner());
        if let Some((val, at)) = cache.get(tool) {
            if at.elapsed() < CMD_CACHE_TTL {
                return *val;
            }
        }
    }
    let result = Command::new("which")
        .arg(tool)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or_else(|_| {
            // Fallback: try `command -v` via direct PATH search
            std::env::var_os("PATH").map_or(false, |paths| {
                std::env::split_paths(&paths).any(|dir| {
                    let full = dir.join(tool);
                    full.is_file() && is_executable(&full)
                })
            })
        });
    if let Ok(mut cache) = CMD_CACHE.lock() {
        cache.insert(tool.to_string(), (result, std::time::Instant::now()));
    }
    result
}

#[cfg(unix)]
fn is_executable(path: &std::path::Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(path)
        .map(|m| m.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}
#[cfg(not(unix))]
fn is_executable(path: &std::path::Path) -> bool {
    path.is_file()
}

/// Detects the current display server session: "wayland", "x11", or "unknown".
pub fn detect_session_type() -> String {
    if let Ok(t) = std::env::var("XDG_SESSION_TYPE") {
        let t = t.to_lowercase();
        if t == "wayland" || t == "x11" {
            return t;
        }
    }
    if std::env::var("WAYLAND_DISPLAY").is_ok() {
        return "wayland".into();
    }
    if std::env::var("DISPLAY").is_ok() {
        return "x11".into();
    }
    "unknown".into()
}

/// Auto-detects the best available paste backend, preferring native tools.
/// ydotool is preferred over wtype because it injects via a kernel uinput device
/// (works on any compositor, no portal prompt), whereas wtype requires the
/// compositor to implement the Wayland virtual-keyboard protocol and fails
/// outright on compositors that don't (e.g. "Compositor does not support the
/// virtual keyboard protocol").
pub fn detect_paste_backend() -> String {
    if command_exists("ydotool") {
        "ydotool".into()
    } else if command_exists("wtype") {
        "wtype".into()
    } else {
        "enigo".into()
    }
}

/// Resolves the user's preferred paste tool against what's actually installed.
///
/// `preference` may be "auto", "wtype", "ydotool", or "enigo". A specific
/// choice is honored when that tool is available; otherwise it gracefully
/// falls back to auto-detection so paste never silently breaks.
pub fn resolve_paste_backend(preference: &str) -> String {
    match preference {
        "wtype" if command_exists("wtype") => "wtype".into(),
        "ydotool" if command_exists("ydotool") => "ydotool".into(),
        "enigo" => "enigo".into(),
        // "auto" or an unavailable explicit choice -> auto-detect
        _ => detect_paste_backend(),
    }
}

#[derive(Serialize)]
pub struct PasteEnvironment {
    /// "wayland", "x11", or "unknown"
    pub session_type: String,
    /// The paste backend that will actually be used: "wtype", "ydotool", or "enigo"
    pub backend: String,
    /// Whether paste is expected to work reliably in the current environment
    pub reliable: bool,
    /// True when the user's explicit tool choice was requested but not installed
    pub preference_unavailable: bool,
    pub has_wtype: bool,
    pub has_ydotool: bool,
}

/// Reports the paste environment for a given user preference so the UI can warn
/// when paste may be unreliable (Wayland without a dedicated tool, since enigo
/// relies on X11) or when a chosen tool isn't installed.
pub fn get_paste_environment(preference: &str) -> PasteEnvironment {
    let session_type = detect_session_type();
    let has_wtype = command_exists("wtype");
    let has_ydotool = command_exists("ydotool");
    let backend = resolve_paste_backend(preference);

    let preference_unavailable = matches!(
        (preference, has_wtype, has_ydotool),
        ("wtype", false, _) | ("ydotool", _, false)
    );

    // enigo injects via X11; on native Wayland it can fail for other apps.
    // Paste is reliable unless the effective backend is enigo on Wayland.
    let reliable = session_type != "wayland" || backend != "enigo";

    PasteEnvironment {
        session_type,
        backend,
        reliable,
        preference_unavailable,
        has_wtype,
        has_ydotool,
    }
}

/// Resolves the paste backend to use right now, re-checking installed tools on
/// every call so a newly installed wtype/ydotool is picked up without a restart.
fn active_backend() -> String {
    let preference = crate::coordinator::PASTE_TOOL
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    if preference.is_empty() || preference == "auto" {
        detect_paste_backend()
    } else {
        resolve_paste_backend(&preference)
    }
}

pub fn paste_text(text: &str, method: &str) -> Result<(), String> {
    if cfg!(debug_assertions) {
        eprintln!(
            "[paste] paste_text method={} len={} backend={}",
            method,
            text.len(),
            active_backend()
        );
    }
    if text.trim().is_empty() {
        if cfg!(debug_assertions) {
            eprintln!("[paste] empty text - nothing to paste");
        }
        return Ok(());
    }
    let r = match method {
        "Direct Typing" => type_text_directly(text),
        _ => paste_via_clipboard(text, method),
    };
    match &r {
        Ok(_) => {
            if cfg!(debug_assertions) {
                eprintln!(
                    "[paste] success method={} backend={}",
                    method,
                    active_backend()
                );
            }
        }
        Err(e) => eprintln!(
            "[paste] failed method={} backend={} err={}",
            method,
            active_backend(),
            e
        ),
    }
    r
}

static CLIPBOARD_GEN: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// A single Enigo instance reused across pastes instead of allocating a fresh
/// display connection on every call (enigo creation is relatively heavy and
/// flaky when done repeatedly). Created lazily on first use; if it ever fails to
/// construct it stays None and the call returns an error, retrying next time.
static ENIGO: Lazy<Mutex<Option<Enigo>>> = Lazy::new(|| Mutex::new(None));

fn with_enigo(f: impl FnOnce(&mut Enigo) -> Result<(), String>) -> Result<(), String> {
    {
        let g = ENIGO.lock().unwrap_or_else(|e| e.into_inner());
        if g.is_some() {
            drop(g);
        } else {
            drop(g);
            for i in 0..3 {
                if i > 0 {
                    thread::sleep(Duration::from_millis(200));
                }
                if let Ok(enigo) = Enigo::new(&Settings {
                    linux_delay: 1,
                    ..Default::default()
                }) {
                    let mut gg = ENIGO.lock().unwrap_or_else(|e| e.into_inner());
                    if gg.is_none() {
                        *gg = Some(enigo);
                    }
                    break;
                }
                let check = ENIGO.lock().unwrap_or_else(|e| e.into_inner());
                if check.is_some() {
                    break;
                }
            }
        }
    }
    let mut g = ENIGO.lock().unwrap_or_else(|e| e.into_inner());
    match g.as_mut() {
        Some(e) => f(e),
        None => Err("Failed to create Enigo".into()),
    }
}

fn paste_via_clipboard(text: &str, method: &str) -> Result<(), String> {
    let mut clipboard = match Clipboard::new() {
        Ok(c) => c,
        Err(_e) => return type_text_directly(text),
    };

    let original_text = clipboard.get_text().ok();
    let expected = text.to_string();
    let gen = CLIPBOARD_GEN.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;

    if let Err(e) = clipboard.set_text(expected.clone()) {
        return Err(format!("Failed to set clipboard text: {}", e));
    }

    let mut ready = false;
    for _ in 0..10 {
        if let Ok(cur) = clipboard.get_text() {
            if cur == expected {
                ready = true;
                break;
            }
        }
        thread::sleep(Duration::from_millis(10));
    }
    if ready {
        thread::sleep(Duration::from_millis(30));
    } else {
        eprintln!("[paste] clipboard poll timed out after 100ms");
    }

    let paste_result = simulate_key_combo(method);

    let restore_text: Option<String> = original_text.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(100));
        // Only restore if no newer dictation has overwritten the clipboard
        if CLIPBOARD_GEN.load(std::sync::atomic::Ordering::Relaxed) != gen {
            return;
        }
        if let Ok(mut c) = Clipboard::new() {
            if let Ok(cur) = c.get_text() {
                if cur == expected {
                    if let Some(orig) = restore_text {
                        let _ = c.set_text(orig);
                    } else {
                        let _ = c.set_text(String::new());
                    }
                }
            }
        }
    });

    paste_result
}

fn simulate_key_combo(method: &str) -> Result<(), String> {
    let backend = active_backend();
    if cfg!(debug_assertions) {
        eprintln!(
            "[paste] simulate_key_combo method={} backend={}",
            method, backend
        );
    }
    // Try preferred backend first, then fall back through the chain
    let mut last_err = String::new();
    let order: Vec<&str> = match backend.as_str() {
        "wtype" => vec!["wtype", "ydotool", "enigo"],
        "ydotool" => vec!["ydotool", "wtype", "enigo"],
        _ => vec!["enigo", "wtype", "ydotool"],
    };
    for b in order {
        if cfg!(debug_assertions) {
            eprintln!("[paste] trying backend={} method={}", b, method);
        }
        let r = match b {
            "wtype" => wtype_paste(method),
            "ydotool" => ydotool_paste(method),
            _ => enigo_paste(method),
        };
        match r {
            Ok(_) => {
                if cfg!(debug_assertions) {
                    eprintln!("[paste] backend {} succeeded", b);
                }
                return Ok(());
            }
            Err(e) => {
                eprintln!("[paste] backend {} failed: {}", b, e);
                last_err = e;
                // try next backend
            }
        }
    }
    Err(last_err)
}

fn run_with_timeout(
    mut cmd: Command,
    timeout: Duration,
) -> Result<std::process::ExitStatus, String> {
    let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn: {}", e))?;
    let start = std::time::Instant::now();
    loop {
        match child.try_wait().map_err(|e| e.to_string())? {
            Some(s) => return Ok(s),
            None if start.elapsed() > timeout => {
                let _ = child.kill();
                // Reap the child so it doesn't linger as a zombie
                let _ = child.wait();
                return Err("Command timed out".into());
            }
            None => thread::sleep(Duration::from_millis(10)),
        }
    }
}

fn wtype_paste(method: &str) -> Result<(), String> {
    let args: Vec<&str> = match method {
        "Ctrl+Shift+V" => vec![
            "-M", "ctrl", "-M", "shift", "-k", "v", "-m", "shift", "-m", "ctrl",
        ],
        "Shift+Insert" => vec!["-M", "shift", "-k", "Insert", "-m", "shift"],
        _ => vec!["-M", "ctrl", "-k", "v", "-m", "ctrl"],
    };

    let mut cmd = Command::new("wtype");
    cmd.args(args).stderr(Stdio::null());
    let status = run_with_timeout(cmd, Duration::from_secs(5))
        .map_err(|e| format!("Failed to run wtype: {}", e))?;

    if status.success() {
        Ok(())
    } else {
        Err("wtype returned non-zero exit status".into())
    }
}

fn ydotool_paste(method: &str) -> Result<(), String> {
    let args: Vec<&str> = match method {
        "Ctrl+Shift+V" => vec!["29:1", "42:1", "47:1", "47:0", "42:0", "29:0"],
        "Shift+Insert" => vec!["42:1", "110:1", "110:0", "42:0"],
        _ => vec!["29:1", "47:1", "47:0", "29:0"],
    };

    let mut cmd = Command::new("ydotool");
    cmd.arg("key").args(args).stderr(Stdio::null());
    let status = run_with_timeout(cmd, Duration::from_secs(5))
        .map_err(|e| format!("Failed to run ydotool: {}", e))?;

    if status.success() {
        Ok(())
    } else {
        Err("ydotool returned non-zero exit status".into())
    }
}

fn enigo_paste(method: &str) -> Result<(), String> {
    with_enigo(|enigo| {
        let res: Result<(), String> = match method {
            "Ctrl+Shift+V" => {
                enigo
                    .key(Key::Control, Direction::Press)
                    .map_err(|e| format!("Enigo Ctrl press failed: {:?}", e))?;
                enigo
                    .key(Key::Shift, Direction::Press)
                    .map_err(|e| format!("Enigo Shift press failed: {:?}", e))?;
                enigo
                    .key(Key::Unicode('v'), Direction::Click)
                    .map_err(|e| format!("Enigo V failed: {:?}", e))
            }
            "Shift+Insert" => {
                enigo
                    .key(Key::Shift, Direction::Press)
                    .map_err(|e| format!("Enigo Shift press failed: {:?}", e))?;
                enigo
                    .key(Key::Insert, Direction::Click)
                    .map_err(|e| format!("Enigo Insert failed: {:?}", e))
            }
            _ => {
                enigo
                    .key(Key::Control, Direction::Press)
                    .map_err(|e| format!("Enigo Ctrl press failed: {:?}", e))?;
                enigo
                    .key(Key::Unicode('v'), Direction::Click)
                    .map_err(|e| format!("Enigo V failed: {:?}", e))
            }
        };
        // Always release modifiers - never leave Ctrl/Shift stuck on partial failure.
        // Releasing a non-pressed key is harmless.
        let _ = enigo.key(Key::Shift, Direction::Release);
        let _ = enigo.key(Key::Control, Direction::Release);
        res
    })
}

fn type_text_directly(text: &str) -> Result<(), String> {
    let backend = active_backend();
    if cfg!(debug_assertions) {
        eprintln!(
            "[paste] type_text_directly backend={} len={}",
            backend,
            text.len()
        );
    }
    match backend.as_str() {
        "wtype" => {
            let mut cmd = Command::new("wtype");
            // Use `--` so leading `-` in transcribed text is not parsed as a flag
            // and to avoid ARG_MAX splitting issues; for very large text consider
            // piping via `wtype -` stdin in future.
            cmd.args(["-d", "0", "--", text]).stderr(Stdio::null());
            let status = run_with_timeout(cmd, Duration::from_secs(5))
                .map_err(|e| format!("Failed to run wtype: {}", e))?;
            if status.success() {
                if cfg!(debug_assertions) {
                    eprintln!("[paste] wtype type succeeded");
                }
                return Ok(());
            } else if cfg!(debug_assertions) {
                eprintln!("[paste] wtype type non-zero status");
            }
        }
        "ydotool" => {
            let mut cmd = Command::new("ydotool");
            cmd.args(["type", "-d", "0", "-H", "0", text])
                .stderr(Stdio::null());
            let status = run_with_timeout(cmd, Duration::from_secs(5))
                .map_err(|e| format!("Failed to run ydotool type: {}", e))?;
            if status.success() {
                if cfg!(debug_assertions) {
                    eprintln!("[paste] ydotool type succeeded");
                }
                return Ok(());
            } else if cfg!(debug_assertions) {
                eprintln!("[paste] ydotool type non-zero status");
            }
        }
        _ => {}
    }

    if cfg!(debug_assertions) {
        eprintln!("[paste] falling back to enigo type");
    }
    with_enigo(|enigo| {
        enigo
            .text(text)
            .map_err(|e| format!("Failed to type text: {:?}", e))
    })
}
