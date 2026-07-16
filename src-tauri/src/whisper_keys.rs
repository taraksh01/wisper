//! Whisper-keys global hotkey backend.
//!
//! Wraps the `handy-keys` crate (built on a raw OS input hook via rdev) so the
//! push-to-talk hotkey fires reliably in every app on X11 and Wayland — unlike
//! Tauri's global-shortcut plugin, which depends on the display server's key
//! grab and fails depending on the focused client.
//!
//! A dedicated manager thread owns the `HotkeyManager` (it is not `Sync`) and
//! polls for events, forwarding press/release as `hotkey::HotkeyEvent` into the
//! existing `coordinator` channel. No action dispatch lives here.

use handy_keys::{Hotkey, HotkeyId, HotkeyManager, HotkeyState};
use std::collections::HashMap;
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Mutex, OnceLock};
use std::thread::{self, JoinHandle};
use tauri::AppHandle;

use crate::hotkey::HotkeyEvent;
use crate::HOTKEY_SENDER;

/// Command sent from the main thread to the manager thread.
enum ManagerCommand {
    Register {
        hotkey_string: String,
        response: Sender<Result<(), String>>,
    },
    UnregisterAll {
        response: Sender<Result<(), String>>,
    },
}

#[derive(Default)]
struct WhisperKeysState {
    command_sender: Mutex<Option<Sender<ManagerCommand>>>,
    thread_handle: Mutex<Option<JoinHandle<()>>>,
}

static STATE: OnceLock<WhisperKeysState> = OnceLock::new();

fn state() -> &'static WhisperKeysState {
    STATE.get_or_init(WhisperKeysState::default)
}

/// Initialize the whisper-keys backend. Spawns the manager thread.
pub fn init(_app: &AppHandle) {
    let (cmd_tx, cmd_rx) = mpsc::channel::<ManagerCommand>();
    *state().command_sender.lock().unwrap() = Some(cmd_tx);
    let handle = thread::spawn(move || manager_thread(cmd_rx));
    *state().thread_handle.lock().unwrap() = Some(handle);
}

/// Register (or re-register) the single push-to-talk hotkey.
pub fn register(hotkey_string: &str) -> Result<(), String> {
    let sender = state()
        .command_sender
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "whisper-keys not initialized".to_string())?;
    let (tx, rx) = mpsc::channel();
    sender
        .send(ManagerCommand::Register {
            hotkey_string: hotkey_string.to_string(),
            response: tx,
        })
        .map_err(|e| e.to_string())?;
    rx.recv().map_err(|e| e.to_string())?
}

/// Unregister the current hotkey (keeps the thread alive).
pub fn unregister_all() -> Result<(), String> {
    let sender = state()
        .command_sender
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "whisper-keys not initialized".to_string())?;
    let (tx, rx) = mpsc::channel();
    sender
        .send(ManagerCommand::UnregisterAll { response: tx })
        .map_err(|e| e.to_string())?;
    rx.recv().map_err(|e| e.to_string())?
}

fn manager_thread(cmd_rx: Receiver<ManagerCommand>) {
    let manager = match HotkeyManager::new_with_blocking() {
        Ok(m) => m,
        Err(e) => {
            eprintln!("whisper-keys: failed to create HotkeyManager: {e}");
            return;
        }
    };

    let mut hotkey_to_id: HashMap<HotkeyId, ()> = HashMap::new();

    loop {
        while let Some(event) = manager.try_recv() {
            if hotkey_to_id.contains_key(&event.id) {
                let pressed = event.state == HotkeyState::Pressed;
                forward(pressed);
            }
        }

        match cmd_rx.recv_timeout(std::time::Duration::from_millis(10)) {
            Ok(ManagerCommand::Register {
                hotkey_string,
                response,
            }) => {
                let _ = response.send(do_register(
                    &manager,
                    &mut hotkey_to_id,
                    &hotkey_string,
                ));
            }
            Ok(ManagerCommand::UnregisterAll { response }) => {
                let _ = response.send(do_unregister_all(&manager, &mut hotkey_to_id));
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
}

fn do_register(
    manager: &HotkeyManager,
    hotkey_to_id: &mut HashMap<HotkeyId, ()>,
    hotkey_string: &str,
) -> Result<(), String> {
    // Clear any previous binding first — we only ever hold one hotkey.
    do_unregister_all(manager, hotkey_to_id)?;
    let hotkey: Hotkey = hotkey_string
        .parse()
        .map_err(|e| format!("invalid hotkey '{hotkey_string}': {e}"))?;
    let id = manager
        .register(hotkey)
        .map_err(|e| format!("failed to register hotkey: {e}"))?;
    hotkey_to_id.insert(id, ());
    Ok(())
}

fn do_unregister_all(
    manager: &HotkeyManager,
    hotkey_to_id: &mut HashMap<HotkeyId, ()>,
) -> Result<(), String> {
    for id in hotkey_to_id.keys() {
        let _ = manager.unregister(*id);
    }
    hotkey_to_id.clear();
    Ok(())
}

/// Forward a press/release into the coordinator's hotkey channel.
fn forward(pressed: bool) {
    if let Ok(guard) = HOTKEY_SENDER.lock() {
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
