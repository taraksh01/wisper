use arboard::Clipboard;
use enigo::{Direction, Enigo, Key, Keyboard, Settings};
use serde::Serialize;
use std::process::{Command, Stdio};
use std::thread;
use std::time::Duration;

/// Returns true if the given command is available on PATH.
fn command_exists(tool: &str) -> bool {
    Command::new("sh")
        .args(["-c", &format!("command -v {}", tool)])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
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
pub fn detect_paste_backend() -> String {
    if command_exists("wtype") {
        "wtype".into()
    } else if command_exists("ydotool") {
        "ydotool".into()
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
    let preference = crate::coordinator::PASTE_TOOL.lock().unwrap().clone();
    if preference.is_empty() {
        // Fall back to the cached backend if no preference has been set yet.
        return crate::coordinator::PASTE_BACKEND.lock().unwrap().clone();
    }
    resolve_paste_backend(&preference)
}

pub fn paste_text(text: &str, method: &str) -> Result<(), String> {
    let r = match method {
        "Direct Typing" => type_text_directly(text),
        _ => paste_via_clipboard(text, method),
    };
    r
}

fn paste_via_clipboard(text: &str, method: &str) -> Result<(), String> {
    let mut clipboard = match Clipboard::new() {
        Ok(c) => c,
        Err(_e) => return type_text_directly(text),
    };

    let original_text = clipboard.get_text().ok();

    if let Err(e) = clipboard.set_text(text.to_string()) {
        return Err(format!("Failed to set clipboard text: {}", e));
    }

    thread::sleep(Duration::from_millis(50));

    let paste_result = simulate_key_combo(method);

    if let Some(orig) = original_text {
        thread::spawn(move || {
            thread::sleep(Duration::from_millis(250));
            if let Ok(mut c) = Clipboard::new() {
                let _ = c.set_text(orig);
            }
        });
    }

    paste_result
}

fn simulate_key_combo(method: &str) -> Result<(), String> {
    let backend = active_backend();
    let r = match backend.as_str() {
        "wtype" => wtype_paste(method),
        "ydotool" => ydotool_paste(method),
        _ => enigo_paste(method),
    };
    r
}

fn wtype_paste(method: &str) -> Result<(), String> {
    let args: Vec<&str> = match method {
        "Ctrl+Shift+V" => vec!["-M", "ctrl", "-M", "shift", "-k", "v", "-m", "shift", "-m", "ctrl"],
        "Shift+Insert" => vec!["-M", "shift", "-k", "Insert", "-m", "shift"],
        _ => vec!["-M", "ctrl", "-k", "v", "-m", "ctrl"],
    };

    let status = Command::new("wtype")
        .args(args)
        .stderr(Stdio::null())
        .status()
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

    let status = Command::new("ydotool")
        .arg("key")
        .args(args)
        .stderr(Stdio::null())
        .status()
        .map_err(|e| format!("Failed to run ydotool: {}", e))?;

    if status.success() {
        Ok(())
    } else {
        Err("ydotool returned non-zero exit status".into())
    }
}

fn enigo_paste(method: &str) -> Result<(), String> {
    let mut enigo = Enigo::new(&Settings::default())
        .map_err(|e| format!("Failed to create Enigo: {:?}", e))?;

    match method {
        "Ctrl+Shift+V" => {
            let _ = enigo.key(Key::Control, Direction::Press);
            let _ = enigo.key(Key::Shift, Direction::Press);
            let _ = enigo.key(Key::Unicode('v'), Direction::Click);
            let _ = enigo.key(Key::Shift, Direction::Release);
            let _ = enigo.key(Key::Control, Direction::Release);
        }
        "Shift+Insert" => {
            let _ = enigo.key(Key::Shift, Direction::Press);
            let _ = enigo.key(Key::Insert, Direction::Click);
            let _ = enigo.key(Key::Shift, Direction::Release);
        }
        _ => {
            let _ = enigo.key(Key::Control, Direction::Press);
            let _ = enigo.key(Key::Unicode('v'), Direction::Click);
            let _ = enigo.key(Key::Control, Direction::Release);
        }
    }

    Ok(())
}

fn type_text_directly(text: &str) -> Result<(), String> {
    let backend = active_backend();
    match backend.as_str() {
        "wtype" => {
            let status = Command::new("wtype")
                .arg(text)
                .stderr(Stdio::null())
                .status()
                .map_err(|e| format!("Failed to run wtype: {}", e))?;
            if status.success() {
                return Ok(());
            }
        }
        "ydotool" => {
            let status = Command::new("ydotool")
                .args(["type", "-d", "0", text])
                .stderr(Stdio::null())
                .status()
                .map_err(|e| format!("Failed to run ydotool type: {}", e))?;
            if status.success() {
                return Ok(());
            }
        }
        _ => {}
    }

    let mut enigo = Enigo::new(&Settings::default())
        .map_err(|e| format!("Failed to create Enigo: {:?}", e))?;

    enigo
        .text(text)
        .map_err(|e| format!("Failed to type text: {:?}", e))
}
