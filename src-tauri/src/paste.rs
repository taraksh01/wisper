use arboard::Clipboard;
use std::process::Command;
use std::thread;
use std::time::Duration;

pub fn is_wayland() -> bool {
    std::env::var("WAYLAND_DISPLAY").is_ok()
        || std::env::var("XDG_SESSION_TYPE")
            .map(|v| v.to_lowercase() == "wayland")
            .unwrap_or(false)
}

pub fn paste_text(text: &str) -> Result<(), String> {
    // 1. Backup existing clipboard content
    let mut clipboard = match Clipboard::new() {
        Ok(c) => c,
        Err(_e) => {
            // Fallback to typing directly if clipboard fails
            return type_text_directly(text);
        }
    };

    let original_text = clipboard.get_text().ok();

    // 2. Set clipboard to new text
    if let Err(e) = clipboard.set_text(text.to_string()) {
        return Err(format!("Failed to set clipboard text: {}", e));
    }

    // Small delay for clipboard synchronization
    thread::sleep(Duration::from_millis(50));

    // 3. Simulate Ctrl+V (or wtype/ydotool on Wayland)
    let paste_result = if is_wayland() {
        paste_wayland()
    } else {
        paste_x11()
    };

    // 4. Restore original clipboard asynchronously after paste completes
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

fn paste_wayland() -> Result<(), String> {
    // Try wtype first
    let status = Command::new("wtype")
        .args(["-M", "ctrl", "-k", "v", "-m", "ctrl"])
        .status();

    if let Ok(s) = status {
        if s.success() {
            return Ok(());
        }
    }

    // Try ydotool second (KEY_LEFTCTRL=29, KEY_V=47)
    let status = Command::new("ydotool")
        .args(["key", "29:1", "47:1", "47:0", "29:0"])
        .status();

    if let Ok(s) = status {
        if s.success() {
            return Ok(());
        }
    }

    // Fallback to enigo
    paste_x11()
}

fn paste_x11() -> Result<(), String> {
    use enigo::{Direction, Enigo, Key, Keyboard, Settings};

    let mut enigo = Enigo::new(&Settings::default())
        .map_err(|e| format!("Failed to create Enigo instance: {:?}", e))?;

    let _ = enigo.key(Key::Control, Direction::Press);
    let _ = enigo.key(Key::Unicode('v'), Direction::Click);
    let _ = enigo.key(Key::Control, Direction::Release);

    Ok(())
}

fn type_text_directly(text: &str) -> Result<(), String> {
    use enigo::{Enigo, Keyboard, Settings};

    let mut enigo = Enigo::new(&Settings::default())
        .map_err(|e| format!("Failed to create Enigo instance: {:?}", e))?;

    enigo
        .text(text)
        .map_err(|e| format!("Failed to type text: {:?}", e))?;

    Ok(())
}
