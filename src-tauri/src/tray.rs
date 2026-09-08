use std::sync::{Arc, Mutex};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    Manager,
};

use crate::coordinator::CoordinatorState;
use crate::{app_info, settings};

/// Runtime-only state (recording/processing) - config lives in AppSettings.
pub static STATE_LOCK: once_cell::sync::Lazy<Arc<Mutex<CoordinatorState>>> =
    once_cell::sync::Lazy::new(|| Arc::new(Mutex::new(CoordinatorState::Idle)));

static APP_HANDLE: once_cell::sync::Lazy<Mutex<Option<tauri::AppHandle>>> =
    once_cell::sync::Lazy::new(|| Mutex::new(None));

fn pretty_model(file: &str) -> String {
    file.replace("parakeet-", "Parakeet ")
        .replace("-int8", " (INT8)")
}

fn tooltip_text() -> String {
    let state = STATE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let dn = app_info::display_name();
    let model = crate::coordinator::MODEL_DISPLAY_NAME
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    match *state {
        CoordinatorState::Idle => {
            if model.is_empty() {
                format!("{} - Idle", dn)
            } else {
                format!("{} - Idle [{}]", dn, model)
            }
        }
        CoordinatorState::Recording => format!("{} - Recording...", dn),
        CoordinatorState::Processing => format!("{} - Processing...", dn),
        CoordinatorState::Error => format!("{} - Error", dn),
    }
}

/// Rebuild the entire menu from current settings. The menu is a pure VIEW:
/// every label is derived here, every action delegates to `settings::ops`.
/// Layout: hotkey · load/unload action | switch | nav | quit
fn rebuild_menu(app: &tauri::AppHandle) -> Result<(), tauri::Error> {
    let Some(tray) = app.tray_by_id("main") else {
        return Ok(());
    };
    let s = settings::AppSettings::load();

    // 1. Hotkey — info only (disabled), opens nowhere
    let hk_display = if s.hotkey.is_empty() {
        "F9".into()
    } else {
        s.hotkey.clone()
    };
    let is_ptt = s.hotkey_mode == "push-to-talk";
    let hotkey_i = MenuItem::with_id(
        app,
        "hotkey",
        format!(
            "Hotkey: {} · {}",
            hk_display,
            if is_ptt { "Push to talk" } else { "Toggle" }
        ),
        false,
        None::<&str>,
    )?;

    // 2. ONE action row - shows the ACTIVE engine's model, not always local
    let model_i = if s.engine_mode == "cloud" {
        let cloud_label = {
            let label = match s.engine_provider.as_str() {
                "openai" => "OpenAI",
                "groq" => "Groq",
                _ => "Custom",
            };
            if s.engine_model.trim().is_empty() {
                format!("{label} · not configured")
            } else {
                format!("{label} · {}", s.engine_model)
            }
        };
        MenuItem::with_id(app, "cloud_model", cloud_label, false, None::<&str>)?
    } else if !s.local_model_file.is_empty() {
        MenuItem::with_id(
            app,
            "unload",
            format!("Unload “{}”", pretty_model(&s.local_model_file)),
            true,
            None::<&str>,
        )?
    } else if !s.last_local_model_file.is_empty() {
        MenuItem::with_id(
            app,
            "reload",
            format!("Load “{}”", pretty_model(&s.last_local_model_file)),
            true,
            None::<&str>,
        )?
    } else {
        MenuItem::with_id(app, "reload", "No model loaded", false, None::<&str>)?
    };

    // 3. Switch engine (enabled only when both engines are usable)
    let has_local = !s.local_model_file.is_empty() || !s.last_local_model_file.is_empty();
    let has_cloud = {
        let key_ok = match s.engine_provider.as_str() {
            "openai" => {
                !s.voice_api_key_openai.trim().is_empty() || !s.voice_api_key.trim().is_empty()
            }
            "groq" => !s.voice_api_key_groq.trim().is_empty() || !s.voice_api_key.trim().is_empty(),
            "custom" => {
                !s.voice_api_key_custom.trim().is_empty() || !s.voice_api_key.trim().is_empty()
            }
            _ => !s.voice_api_key.trim().is_empty(),
        };
        let base_ok = s.engine_provider != "custom" || !s.engine_base_url.trim().is_empty();
        key_ok && !s.engine_model.trim().is_empty() && base_ok
    };
    let switch_i = if has_local && has_cloud {
        let label = if s.engine_mode == "cloud" {
            "Switch to On-device"
        } else {
            "Switch to Cloud"
        };
        MenuItem::with_id(app, "switch", label, true, None::<&str>)?
    } else {
        MenuItem::with_id(app, "switch", "Switch engine", false, None::<&str>)?
    };

    // 4. Open + Quit only — no redundant Settings/History (Open restores last tab)
    let open_i = MenuItem::with_id(app, "open", "Open Wisper", true, None::<&str>)?;
    let quit_i = MenuItem::with_id(
        app,
        "quit",
        format!("Quit {}", app_info::display_name()),
        true,
        None::<&str>,
    )?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;

    let menu = Menu::with_items(
        app,
        &[
            &hotkey_i, &model_i, &sep1, &switch_i, &sep2, &open_i, &quit_i,
        ],
    )?;
    tray.set_menu(Some(menu))?;
    tray.set_tooltip(Some(tooltip_text()))?;
    Ok(())
}

/// Refresh the whole tray (menu + tooltip) from current settings.
pub fn refresh() {
    if let Some(handle) = APP_HANDLE
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
    {
        let _ = rebuild_menu(handle);
    }
}

pub fn build_tray(app: &tauri::AppHandle) -> Result<tauri::tray::TrayIcon, tauri::Error> {
    *APP_HANDLE.lock().unwrap_or_else(|e| e.into_inner()) = Some(app.clone());

    let dev_icon: Option<tauri::image::Image<'static>> = if app_info::is_dev() {
        let bytes = include_bytes!("../icons/dev/icon.png");
        match tauri::image::Image::from_bytes(bytes) {
            Ok(icon) => Some(icon),
            Err(e) => {
                eprintln!("[dev] Image::from_bytes failed: {}", e);
                None
            }
        }
    } else {
        None
    };

    if let Some(dev_icon) = dev_icon.clone() {
        if let Some(win) = app.get_webview_window("main") {
            let _ = win.set_icon(dev_icon.clone());
        }
    }
    let tray_icon = dev_icon
        .or_else(|| app.default_window_icon().cloned())
        .unwrap_or_else(|| {
            eprintln!("no tray icon available, using fallback");
            tauri::image::Image::new(&[0, 0, 0, 0], 1, 1)
        });

    let tray = TrayIconBuilder::with_id("main")
        .icon(tray_icon)
        .show_menu_on_left_click(false)
        .tooltip(&format!("{} - Idle", app_info::display_name()))
        .on_menu_event(|app, event| match event.id.as_ref() {
            "quit" => app.exit(0),
            "unload" => settings::unload_local_model(app),
            "reload" => settings::reload_last_model(app),
            "switch" => settings::switch_engine_mode(app),
            "open" => show_main(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;

    rebuild_menu(app)?;
    Ok(tray)
}

fn show_main(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.set_focus();
    }
}
