use rdev::{listen, Event, EventType, Key};
use std::sync::mpsc::Sender;
use std::thread;

pub enum HotkeyEvent {
    Pressed,
    Released,
}

pub struct HotkeyManager {
    // The configured key to trigger dictation
    trigger_key: Key,
    // Channel to send events back to the main app/coordinator
    tx: Sender<HotkeyEvent>,
}

impl HotkeyManager {
    pub fn new(trigger_key: Key, tx: Sender<HotkeyEvent>) -> Self {
        Self { trigger_key, tx }
    }

    pub fn start_listening(self) {
        let trigger_key = self.trigger_key;
        let tx = self.tx;

        thread::spawn(move || {
            let callback = move |event: Event| {
                match event.event_type {
                    EventType::KeyPress(key) if key == trigger_key => {
                        let _ = tx.send(HotkeyEvent::Pressed);
                    }
                    EventType::KeyRelease(key) if key == trigger_key => {
                        let _ = tx.send(HotkeyEvent::Released);
                    }
                    _ => {}
                }
            };

            if let Err(error) = listen(callback) {
                eprintln!("Error listening for global hotkeys: {:?}", error);
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    #[test]
    fn test_hotkey_manager_creation() {
        let (tx, rx) = mpsc::channel();
        let _manager = HotkeyManager::new(Key::F12, tx.clone());
        tx.send(HotkeyEvent::Pressed).unwrap();
        assert!(matches!(rx.recv().unwrap(), HotkeyEvent::Pressed));
    }
}
