//! Origin binding (macOS): remember the frontmost app when the hotkey is
//! pressed and refocus it before paste, so mid-dictation window switches
//! don't send text to the wrong place.
//!
//! App-level binding (pid + bundle id) via NSWorkspace — no window titles,
//! no new permissions beyond the Accessibility grant hotkeys already need.
//! Non-macOS builds get stubs so the coordinator wiring stays shared.

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct OriginTarget {
    pub backend: String,
    /// Owning process id.
    pub addr: String,
    /// Bundle id, or process name when unbundled.
    pub app_id: String,
    /// Localized app name for logs/toasts.
    pub title: String,
    pub icon_data_url: Option<String>,
}

fn is_self(name: &str, bundle: &str) -> bool {
    bundle == "com.taraksh01.wisper"
        || bundle == "com.taraksh01.wisper-dev"
        || name.eq_ignore_ascii_case("wisper")
        || name.eq_ignore_ascii_case("wisper dev")
}

#[cfg(target_os = "macos")]
pub fn capture_origin() -> Option<OriginTarget> {
    use objc2_app_kit::NSWorkspace;

    let front = NSWorkspace::sharedWorkspace().frontmostApplication()?;
    let name = front
        .localizedName()
        .map(|s| s.to_string())
        .unwrap_or_default();
    let bundle = front
        .bundleIdentifier()
        .map(|s| s.to_string())
        .unwrap_or_default();
    let pid = front.processIdentifier();
    if pid <= 0 || is_self(&name, &bundle) {
        return None;
    }
    let app_id = if bundle.is_empty() {
        name.clone()
    } else {
        bundle
    };
    if app_id.is_empty() {
        return None;
    }
    Some(OriginTarget {
        backend: "macos".into(),
        addr: pid.to_string(),
        app_id,
        title: name,
        icon_data_url: None,
    })
}

#[cfg(target_os = "macos")]
fn app_for_pid(pid: i32) -> Option<objc2::rc::Retained<objc2_app_kit::NSRunningApplication>> {
    use objc2_app_kit::NSRunningApplication;

    if pid <= 0 {
        return None;
    }
    NSRunningApplication::runningApplicationWithProcessIdentifier(pid)
}

/// True while the origin app still exists. Compares bundle id/name too so a
/// recycled pid never validates a different app.
#[cfg(target_os = "macos")]
pub fn is_origin_alive(target: &OriginTarget) -> bool {
    let Ok(pid) = target.addr.parse::<i32>() else {
        return false;
    };
    let Some(app) = app_for_pid(pid) else {
        return false;
    };
    if app.isTerminated() {
        return false;
    }
    let bundle = app
        .bundleIdentifier()
        .map(|s| s.to_string())
        .unwrap_or_default();
    let name = app
        .localizedName()
        .map(|s| s.to_string())
        .unwrap_or_default();
    let id_now = if bundle.is_empty() { name } else { bundle };
    id_now == target.app_id
}

/// Refocus the origin app. Returns true once it is frontmost again.
#[cfg(target_os = "macos")]
pub fn focus_origin(target: &OriginTarget) -> bool {
    use objc2_app_kit::{NSApplicationActivationOptions, NSWorkspace};

    let Ok(pid) = target.addr.parse::<i32>() else {
        return false;
    };
    let Some(app) = app_for_pid(pid) else {
        return false;
    };
    if app.isTerminated() {
        return false;
    }
    app.activateWithOptions(
        NSApplicationActivationOptions::ActivateAllWindows
            | NSApplicationActivationOptions::ActivateIgnoringOtherApps,
    );
    let ws = NSWorkspace::sharedWorkspace();
    let start = std::time::Instant::now();
    while start.elapsed() < std::time::Duration::from_millis(500) {
        if ws
            .frontmostApplication()
            .map(|f| f.processIdentifier() == pid)
            .unwrap_or(false)
        {
            return true;
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    ws.frontmostApplication()
        .map(|f| f.processIdentifier() == pid)
        .unwrap_or(false)
}

#[cfg(not(target_os = "macos"))]
pub fn capture_origin() -> Option<OriginTarget> {
    None
}

#[cfg(not(target_os = "macos"))]
pub fn is_origin_alive(_target: &OriginTarget) -> bool {
    false
}

#[cfg(not(target_os = "macos"))]
pub fn focus_origin(_target: &OriginTarget) -> bool {
    false
}
