pub enum HotkeyEvent {
    Pressed,
    Released,
}

/// Forward a press/release into the coordinator's hotkey channel.
pub fn forward(pressed: bool) {
    if let Ok(guard) = crate::HOTKEY_SENDER.lock() {
        if let Some(tx) = guard.as_ref() {
            if let Ok(s) = tx.lock() {
                let _ = s.send(if pressed {
                    HotkeyEvent::Pressed
                } else {
                    HotkeyEvent::Released
                });
            }
        }
    }
}
