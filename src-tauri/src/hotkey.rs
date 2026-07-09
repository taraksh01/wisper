use rdev::{listen, Event, EventType, Key};
use std::collections::HashSet;
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};
use std::thread;

pub enum HotkeyEvent {
    Pressed,
    Released,
}

#[derive(Debug, Clone)]
pub struct HotkeyBinding {
    pub ctrl: bool,
    pub alt: bool,
    pub shift: bool,
    pub meta: bool,
    pub key: Key,
}

impl HotkeyBinding {
    pub fn matches(&self, pressed: &HashSet<Key>) -> bool {
        let has_ctrl = pressed.contains(&Key::ControlLeft) || pressed.contains(&Key::ControlRight);
        let has_alt = pressed.contains(&Key::Alt) || pressed.contains(&Key::AltGr);
        let has_shift = pressed.contains(&Key::ShiftLeft) || pressed.contains(&Key::ShiftRight);
        let has_meta = pressed.contains(&Key::MetaLeft) || pressed.contains(&Key::MetaRight);

        has_ctrl == self.ctrl
            && has_alt == self.alt
            && has_shift == self.shift
            && has_meta == self.meta
            && pressed.contains(&self.key)
    }
}

pub struct HotkeyManager {
    binding: Arc<Mutex<HotkeyBinding>>,
    tx: Sender<HotkeyEvent>,
}

impl HotkeyManager {
    pub fn new(binding: Arc<Mutex<HotkeyBinding>>, tx: Sender<HotkeyEvent>) -> Self {
        Self { binding, tx }
    }

    pub fn start_listening(self) {
        let binding = self.binding;
        let tx = self.tx;

        thread::spawn(move || {
            let mut pressed: HashSet<Key> = HashSet::new();
            let mut was_pressed = false;

            if let Err(error) = listen(move |event: Event| {
                let current = binding.lock().unwrap().clone();
                match event.event_type {
                    EventType::KeyPress(key) => {
                        pressed.insert(key);
                        if current.matches(&pressed) && !was_pressed {
                            was_pressed = true;
                            let _ = tx.send(HotkeyEvent::Pressed);
                        }
                    }
                    EventType::KeyRelease(key) => {
                        pressed.remove(&key);
                        if was_pressed && !current.matches(&pressed) {
                            was_pressed = false;
                            let _ = tx.send(HotkeyEvent::Released);
                        }
                    }
                    _ => {}
                }
            }) {
                eprintln!("Error listening for global hotkeys: {:?}", error);
            }
        });
    }
}

pub fn parse_binding(s: &str) -> Option<HotkeyBinding> {
    let parts: Vec<&str> = s.split('+').map(|p| p.trim()).collect();
    if parts.is_empty() || parts.len() > 5 {
        return None;
    }

    let mut ctrl = false;
    let mut alt = false;
    let mut shift = false;
    let mut meta = false;

    for &p in &parts[..parts.len() - 1] {
        match p {
            "Control" | "Ctrl" => ctrl = true,
            "Alt" => alt = true,
            "Shift" => shift = true,
            "Meta" | "Cmd" | "Super" | "Windows" => meta = true,
            _ => return None,
        }
    }

    let key = parse_key(parts[parts.len() - 1])?;

    Some(HotkeyBinding { ctrl, alt, shift, meta, key })
}

pub fn parse_key(name: &str) -> Option<Key> {
    let key = match name {
        "Alt" | "AltGr" => return None,
        "Backspace" => Key::Backspace,
        "CapsLock" => Key::CapsLock,
        "Delete" => Key::Delete,
        "DownArrow" | "ArrowDown" => Key::DownArrow,
        "End" => Key::End,
        "Escape" => Key::Escape,
        "Home" => Key::Home,
        "Insert" => Key::Insert,
        "LeftArrow" | "ArrowLeft" => Key::LeftArrow,
        "PageDown" => Key::PageDown,
        "PageUp" => Key::PageUp,
        "Return" | "Enter" => Key::Return,
        "RightArrow" | "ArrowRight" => Key::RightArrow,
        "Space" | " " => Key::Space,
        "Tab" => Key::Tab,
        "UpArrow" | "ArrowUp" => Key::UpArrow,
        "PrintScreen" => Key::PrintScreen,
        "ScrollLock" => Key::ScrollLock,
        "Pause" => Key::Pause,
        "NumLock" => Key::NumLock,
        "F1" => Key::F1,
        "F2" => Key::F2,
        "F3" => Key::F3,
        "F4" => Key::F4,
        "F5" => Key::F5,
        "F6" => Key::F6,
        "F7" => Key::F7,
        "F8" => Key::F8,
        "F9" => Key::F9,
        "F10" => Key::F10,
        "F11" => Key::F11,
        "F12" => Key::F12,
        n if n.len() == 1 => {
            let c = n.chars().next()?;
            match c.to_ascii_lowercase() {
                'a' => Key::KeyA,
                'b' => Key::KeyB,
                'c' => Key::KeyC,
                'd' => Key::KeyD,
                'e' => Key::KeyE,
                'f' => Key::KeyF,
                'g' => Key::KeyG,
                'h' => Key::KeyH,
                'i' => Key::KeyI,
                'j' => Key::KeyJ,
                'k' => Key::KeyK,
                'l' => Key::KeyL,
                'm' => Key::KeyM,
                'n' => Key::KeyN,
                'o' => Key::KeyO,
                'p' => Key::KeyP,
                'q' => Key::KeyQ,
                'r' => Key::KeyR,
                's' => Key::KeyS,
                't' => Key::KeyT,
                'u' => Key::KeyU,
                'v' => Key::KeyV,
                'w' => Key::KeyW,
                'x' => Key::KeyX,
                'y' => Key::KeyY,
                'z' => Key::KeyZ,
                '0' => Key::Num0,
                '1' => Key::Num1,
                '2' => Key::Num2,
                '3' => Key::Num3,
                '4' => Key::Num4,
                '5' => Key::Num5,
                '6' => Key::Num6,
                '7' => Key::Num7,
                '8' => Key::Num8,
                '9' => Key::Num9,
                _ => return None,
            }
        }
        _ => return None,
    };
    Some(key)
}

pub fn is_modifier_key(name: &str) -> bool {
    matches!(name, "Shift" | "Control" | "Ctrl" | "Alt" | "Meta" | "Cmd" | "Super" | "Windows")
}
