//! Global-shortcuts portal (XDG) hotkey backend.
//!
//! Registers the push-to-talk hotkey through `org.freedesktop.portal.GlobalShortcuts`
//! (the xdg-desktop-portal interface implemented by GNOME 42+ and KDE Plasma 6+).
//! The compositor owns the grab, so the hotkey works in every app, is consumed
//! (never typed into the focused window) and supports hold-to-talk through the
//! Activated/Deactivated signals.
//!
//! A dedicated manager thread owns the portal session (it is not `Sync`) and
//! serializes binds; press/release is forwarded into the existing `coordinator`
//! channel as `hotkey::HotkeyEvent`. No action dispatch lives here.
//!
//! Backend selection happens once at startup (see lib.rs): portal first, then
//! the whisper-keys evdev fallback. The portal is only usable when the system
//! has a working GlobalShortcuts portal, which `init` reports to the caller.

use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Mutex, OnceLock};
use std::thread::{self, JoinHandle};

use ashpd::desktop::global_shortcuts::{
    BindShortcutsOptions, GlobalShortcuts, NewShortcut,
};
use ashpd::desktop::{CreateSessionOptions, Session};
use futures_util::StreamExt;
use pollster::block_on;

const SHORTCUT_ID: &str = "wisper-push-to-talk";

/// Command sent from the main thread to the manager thread.
enum ManagerCommand {
    Bind {
        hotkey_string: String,
        response: Sender<Result<(), String>>,
    },
}

#[derive(Default)]
struct PortalState {
    command_sender: Mutex<Option<Sender<ManagerCommand>>>,
    thread_handle: Mutex<Option<JoinHandle<()>>>,
}

static STATE: OnceLock<PortalState> = OnceLock::new();

fn state() -> &'static PortalState {
    STATE.get_or_init(PortalState::default)
}

/// Try to bring up the portal backend. Returns `false` when the portal is not
/// available (no xdg-desktop-portal / no GlobalShortcuts implementation), so
/// the caller can fall back to whisper-keys.
pub fn init(_app: &tauri::AppHandle) -> bool {
    let (cmd_tx, cmd_rx) = mpsc::channel::<ManagerCommand>();
    let (ready_tx, ready_rx) = mpsc::channel::<bool>();
    *state().command_sender.lock().unwrap() = Some(cmd_tx);
    let handle = thread::spawn(move || manager_thread(cmd_rx, ready_tx));
    *state().thread_handle.lock().unwrap() = Some(handle);
    match ready_rx.recv_timeout(std::time::Duration::from_secs(5)) {
        Ok(available) => available,
        Err(_) => {
            eprintln!("portal: manager thread did not report availability");
            false
        }
    }
}

/// Register (or re-register) the push-to-talk hotkey. Each call creates a
/// fresh portal session (the spec allows binding only once per session).
pub fn register(hotkey_string: &str) -> Result<(), String> {
    let sender = state()
        .command_sender
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "portal not initialized".to_string())?;
    let (tx, rx) = mpsc::channel();
    sender
        .send(ManagerCommand::Bind {
            hotkey_string: hotkey_string.to_string(),
            response: tx,
        })
        .map_err(|_| "portal unavailable".to_string())?;
    rx.recv().map_err(|_| "portal unavailable".to_string())?
}

fn manager_thread(cmd_rx: Receiver<ManagerCommand>, ready_tx: Sender<bool>) {
    let shortcuts = match block_on(GlobalShortcuts::new()) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("portal: unavailable ({e})");
            let _ = ready_tx.send(false);
            return;
        }
    };
    let activated = match block_on(shortcuts.receive_activated()) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("portal: cannot listen for Activated: {e}");
            let _ = ready_tx.send(false);
            return;
        }
    };
    let deactivated = match block_on(shortcuts.receive_deactivated()) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("portal: cannot listen for Deactivated: {e}");
            let _ = ready_tx.send(false);
            return;
        }
    };
    // Signal streams are owned ('static); run one thread per direction.
    thread::spawn(move || {
        let mut stream = activated;
        while let Some(_ev) = block_on(stream.next()) {
            crate::hotkey::forward(true);
        }
    });
    thread::spawn(move || {
        let mut stream = deactivated;
        while let Some(_ev) = block_on(stream.next()) {
            crate::hotkey::forward(false);
        }
    });

    let _ = ready_tx.send(true);
    eprintln!("portal: global shortcuts active");

    let mut session: Option<Session<GlobalShortcuts>> = None;
    while let Ok(cmd) = cmd_rx.recv() {
        let ManagerCommand::Bind {
            hotkey_string,
            response,
        } = cmd;
        let _ = response.send(do_bind(&shortcuts, &mut session, &hotkey_string));
    }
    // Session drops with the connection; the portal closes it.
}

fn do_bind(
    shortcuts: &GlobalShortcuts,
    session: &mut Option<Session<GlobalShortcuts>>,
    hotkey_string: &str,
) -> Result<(), String> {
    // The spec allows binding only once per session, so every re-bind starts a
    // fresh session (and drops the previous binding along with the old one).
    if let Some(old) = session.take() {
        let _ = block_on(old.close());
    }
    let new_session = block_on(shortcuts.create_session(CreateSessionOptions::default()))
        .map_err(|e| format!("portal: failed to create session: {e}"))?;
    let trigger = normalize_trigger(hotkey_string);
    let shortcut = NewShortcut::new(SHORTCUT_ID, "Push to talk")
        .preferred_trigger(Some(trigger.as_str()));
    let request = block_on(shortcuts.bind_shortcuts(
        &new_session,
        &[shortcut],
        None,
        BindShortcutsOptions::default(),
    ))
    .map_err(|e| format!("portal: failed to bind hotkey: {e}"))?;
    // Blocks until the compositor answers (a dialog on first/changed binds;
    // instant when the binding is already approved). Cancelled = error.
    match request.response() {
        Ok(_) => {
            *session = Some(new_session);
            Ok(())
        }
        Err(e) => {
            let _ = block_on(new_session.close());
            Err(format!("hotkey rejected by the system: {e}"))
        }
    }
}

/// Convert the app's hotkey format ("Ctrl+Space", "ArrowUp", "F5") into the
/// XDG shortcuts-spec trigger format the portal expects ("CTRL+SPACE").
fn normalize_trigger(hotkey: &str) -> String {
    hotkey
        .split('+')
        .map(|part| match part.trim() {
            "ArrowUp" => "UP".into(),
            "ArrowDown" => "DOWN".into(),
            "ArrowLeft" => "LEFT".into(),
            "ArrowRight" => "RIGHT".into(),
            "PageUp" => "PAGE_UP".into(),
            "PageDown" => "PAGE_DOWN".into(),
            p => p.to_uppercase(),
        })
        .collect::<Vec<_>>()
        .join("+")
}
