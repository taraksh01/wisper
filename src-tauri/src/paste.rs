use arboard::Clipboard;
use enigo::{Direction, Enigo, Key, Keyboard, Settings};
use std::process::{Command, Stdio};
use std::thread;
use std::time::Duration;

pub fn detect_paste_backend() -> String {
    let check = |tool: &str| -> bool {
        Command::new("sh")
            .args(["-c", &format!("command -v {}", tool)])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    };

    if check("wtype") {
        "wtype".into()
    } else if check("ydotool") {
        "ydotool".into()
    } else {
        "enigo".into()
    }
}

pub fn paste_text(text: &str, method: &str) -> Result<(), String> {
    match method {
        "Direct Typing" => type_text_directly(text),
        _ => paste_via_clipboard(text, method),
    }
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
    let backend = crate::coordinator::PASTE_BACKEND.lock().unwrap().clone();
    match backend.as_str() {
        "wtype" => wtype_paste(method),
        "ydotool" => ydotool_paste(method),
        _ => enigo_paste(method),
    }
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
    let backend = crate::coordinator::PASTE_BACKEND.lock().unwrap().clone();
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
