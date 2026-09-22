#[cfg(not(target_os = "windows"))]
use std::path::Path;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::Duration;

use serde::Serialize;

pub const WISPER_GNOME_EXT_UUID: &str = "wisper-focus@wisper.app";

#[derive(Debug, Clone, Serialize)]
pub struct OriginEnvironment {
    pub session_type: String,
    pub is_gnome: bool,
    pub needs_extension: bool,
    pub installed: bool,
    pub enabled_in_settings: bool,
    pub active: bool,
    pub ready: bool,
    pub needs_relogin: bool,
}

#[derive(Debug, Clone)]
pub struct OriginTarget {
    pub backend: String,
    pub addr: String,
    pub app_id: String,
    pub title: String,
    pub icon_data_url: Option<String>,
}

fn run_cmd_output(cmd: &str, args: &[&str], timeout: Duration) -> Option<String> {
    let mut child = Command::new(cmd)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let start = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    return None;
                }
                let mut out = String::new();
                if let Some(mut stdout) = child.stdout.take() {
                    use std::io::Read;
                    let _ = stdout.read_to_string(&mut out);
                }
                let trimmed = out.trim().to_string();
                if trimmed.is_empty() {
                    return None;
                }
                return Some(trimmed);
            }
            Ok(None) if start.elapsed() > timeout => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(10)),
            Err(_) => return None,
        }
    }
}

fn run_cmd_status(cmd: &str, args: &[&str], timeout: Duration) -> bool {
    let mut child = match Command::new(cmd)
        .args(args)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(c) => c,
        Err(_) => return false,
    };
    let start = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return status.success(),
            Ok(None) if start.elapsed() > timeout => {
                let _ = child.kill();
                let _ = child.wait();
                return false;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(10)),
            Err(_) => return false,
        }
    }
}

fn placeholder_data_url(label: &str) -> String {
    let ch = label
        .trim()
        .chars()
        .next()
        .map(|c| c.to_uppercase().to_string())
        .unwrap_or_else(|| "A".to_string());
    let escaped = ch
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;");
    let svg = format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"64\" height=\"64\" viewBox=\"0 0 64 64\"><circle cx=\"32\" cy=\"32\" r=\"32\" fill=\"#fb923c\"/><text x=\"32\" y=\"38\" text-anchor=\"middle\" font-family=\"sans-serif\" font-size=\"28\" font-weight=\"700\" fill=\"white\">{}</text></svg>",
        escaped
    );
    use base64::Engine as _;
    let b64 = base64::engine::general_purpose::STANDARD.encode(svg.as_bytes());
    format!("data:image/svg+xml;base64,{b64}")
}

fn icon_with_placeholder(app_id: &str, title: &str) -> Option<String> {
    #[cfg(not(target_os = "windows"))]
    if let Some(url) = resolve_icon_data_url(app_id) {
        return Some(url);
    }
    let label = if !app_id.trim().is_empty() {
        app_id
    } else if !title.trim().is_empty() {
        title
    } else {
        "App"
    };
    Some(placeholder_data_url(label))
}

#[cfg(not(target_os = "windows"))]
fn resolve_icon_data_url(app_id: &str) -> Option<String> {
    if app_id.trim().is_empty() {
        return None;
    }
    let icon_name = find_icon_for_app_id(app_id)?;
    let path = resolve_icon_path(&icon_name)?;
    let bytes = std::fs::read(&path).ok()?;
    if bytes.len() > 256 * 1024 {
        return None;
    }
    let mime = if path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        == Some("svg".into())
    {
        "image/svg+xml"
    } else if path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        == Some("jpg".into())
        || path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase())
            == Some("jpeg".into())
    {
        "image/jpeg"
    } else {
        "image/png"
    };
    use base64::Engine as _;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Some(format!("data:{mime};base64,{b64}"))
}

#[cfg(not(target_os = "windows"))]
fn find_icon_for_app_id(app_id: &str) -> Option<String> {
    let lower = app_id.to_lowercase();
    let mut search_dirs: Vec<PathBuf> = Vec::new();
    if let Some(home) = dirs::data_local_dir() {
        // data_local_dir is ~/.local/share
        search_dirs.push(home.join("applications"));
        search_dirs.push(home.join("flatpak/exports/share/applications"));
    }
    if let Some(home) = dirs::home_dir() {
        search_dirs.push(home.join(".local/share/applications"));
        search_dirs.push(home.join(".local/share/flatpak/exports/share/applications"));
    }
    search_dirs.push(PathBuf::from("/usr/share/applications"));
    search_dirs.push(PathBuf::from("/var/lib/flatpak/exports/share/applications"));
    search_dirs.push(PathBuf::from("/usr/local/share/applications"));
    if let Ok(xdg) = std::env::var("XDG_DATA_DIRS") {
        for p in xdg.split(':') {
            if !p.is_empty() {
                search_dirs.push(PathBuf::from(p).join("applications"));
            }
        }
    }
    let mut best: Option<String> = None;
    for dir in &search_dirs {
        let entries = match std::fs::read_dir(dir) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("desktop") {
                continue;
            }
            let fname = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_lowercase();
            if fname == lower {
                if let Some(icon) = read_desktop_icon(&path) {
                    return Some(icon);
                }
            }
            if let Some(icon) = read_desktop_match(&path, &lower) {
                if best.is_none() {
                    best = Some(icon);
                }
            }
        }
        if best.is_some() {
            return best;
        }
    }
    if best.is_some() {
        return best;
    }
    // No desktop file matched; treat app_id itself as icon name (themed)
    Some(app_id.to_string())
}

#[cfg(not(target_os = "windows"))]
fn read_desktop_icon(path: &Path) -> Option<String> {
    let content = std::fs::read_to_string(path).ok()?;
    for line in content.lines() {
        let l = line.trim();
        if l.starts_with("Icon=") {
            let v = l.trim_start_matches("Icon=").trim().to_string();
            if !v.is_empty() {
                return Some(v);
            }
        }
    }
    None
}

#[cfg(not(target_os = "windows"))]
fn read_desktop_match(path: &Path, lower_app_id: &str) -> Option<String> {
    let content = std::fs::read_to_string(path).ok()?;
    let mut wm_class: Option<String> = None;
    let mut icon: Option<String> = None;
    for line in content.lines() {
        let l = line.trim();
        if l.starts_with("StartupWMClass=") {
            wm_class = Some(
                l.trim_start_matches("StartupWMClass=")
                    .trim()
                    .to_lowercase(),
            );
        } else if l.starts_with("Icon=") && icon.is_none() {
            icon = Some(l.trim_start_matches("Icon=").trim().to_string());
        }
    }
    if let Some(wc) = wm_class {
        if wc == lower_app_id {
            return icon;
        }
    }
    None
}

#[cfg(not(target_os = "windows"))]
fn resolve_icon_path(icon: &str) -> Option<PathBuf> {
    if icon.starts_with('/') {
        let p = PathBuf::from(icon);
        if p.is_file() {
            return Some(p);
        }
        // try with common extensions
        for ext in &[".png", ".svg", ".jpg"] {
            let q = PathBuf::from(format!("{icon}{ext}"));
            if q.is_file() {
                return Some(q);
            }
        }
        return None;
    }
    // themed name: walk icon theme dirs
    let mut theme_dirs: Vec<PathBuf> = Vec::new();
    if let Some(home) = dirs::data_local_dir() {
        theme_dirs.push(home.join("icons"));
    }
    if let Some(home) = dirs::home_dir() {
        theme_dirs.push(home.join(".local/share/icons"));
        theme_dirs.push(home.join(".icons"));
    }
    theme_dirs.push(PathBuf::from("/usr/share/icons"));
    theme_dirs.push(PathBuf::from("/usr/share/pixmaps"));
    theme_dirs.push(PathBuf::from("/var/lib/flatpak/exports/share/icons"));

    for base in &theme_dirs {
        if base.ends_with("pixmaps") {
            for ext in &[".png", ".svg", ".xpm", ".jpg", ""] {
                let p = base.join(format!("{icon}{ext}"));
                if p.is_file() {
                    return Some(p);
                }
            }
            continue;
        }
        let entries = match std::fs::read_dir(base) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for theme_entry in entries.flatten() {
            let theme_path = theme_entry.path();
            if !theme_path.is_dir() {
                continue;
            }
            // depth 1: theme name, depth 2: size dir, look for apps
            let sub = match std::fs::read_dir(&theme_path) {
                Ok(s) => s,
                Err(_) => continue,
            };
            for sub_entry in sub.flatten() {
                let sub_path = sub_entry.path();
                let try_paths = if sub_path.is_dir() {
                    // could be 48x48/apps or apps
                    let mut v = Vec::new();
                    v.push(sub_path.join("apps"));
                    v.push(sub_path.clone());
                    v
                } else {
                    vec![theme_path.clone()]
                };
                for tp in try_paths {
                    for ext in &[".png", ".svg", ".jpg", ".xpm"] {
                        let p = tp.join(format!("{icon}{ext}"));
                        if p.is_file() {
                            return Some(p);
                        }
                    }
                }
            }
            // also try directly under theme
            for ext in &[".png", ".svg"] {
                let p = theme_path.join(format!("{icon}{ext}"));
                if p.is_file() {
                    return Some(p);
                }
            }
        }
    }
    None
}

#[cfg(not(target_os = "windows"))]
fn capture_hyprland() -> Option<OriginTarget> {
    let out = run_cmd_output(
        "hyprctl",
        &["activewindow", "-j"],
        Duration::from_millis(400),
    )?;
    let v: serde_json::Value = serde_json::from_str(&out).ok()?;
    let addr = v.get("address")?.as_str()?.trim().to_string();
    if addr.is_empty() || addr == "0x0" {
        return None;
    }
    let app_id = v
        .get("class")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let app_id = if app_id.is_empty() {
        v.get("initialClass")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .trim()
            .to_string()
    } else {
        app_id
    };
    let title = v
        .get("title")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if app_id.is_empty() && title.is_empty() {
        return None;
    }
    let icon_data_url = icon_with_placeholder(&app_id, &title);
    Some(OriginTarget {
        backend: "hyprland".into(),
        addr,
        app_id,
        title,
        icon_data_url,
    })
}

#[cfg(not(target_os = "windows"))]
fn find_focused_sway(node: &serde_json::Value) -> Option<(String, String, String)> {
    if node.get("focused").and_then(|v| v.as_bool()) == Some(true) {
        let id = node
            .get("id")
            .and_then(|v| v.as_i64())
            .map(|v| v.to_string())
            .unwrap_or_default();
        let app_id = node
            .get("app_id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let app_id = if app_id.is_empty() {
            node.get("window_properties")
                .and_then(|w| w.get("class"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string()
        } else {
            app_id
        };
        let title = node
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if !id.is_empty() {
            return Some((id, app_id, title));
        }
    }
    for key in &["nodes", "floating_nodes"] {
        if let Some(arr) = node.get(*key).and_then(|v| v.as_array()) {
            for child in arr {
                if let Some(found) = find_focused_sway(child) {
                    return Some(found);
                }
            }
        }
    }
    None
}

#[cfg(not(target_os = "windows"))]
fn capture_sway() -> Option<OriginTarget> {
    let out = run_cmd_output("swaymsg", &["-t", "get_tree"], Duration::from_millis(400))?;
    let v: serde_json::Value = serde_json::from_str(&out).ok()?;
    let (addr, app_id, title) = find_focused_sway(&v)?;
    if addr.is_empty() {
        return None;
    }
    let icon_data_url = icon_with_placeholder(&app_id, &title);
    Some(OriginTarget {
        backend: "sway".into(),
        addr,
        app_id,
        title,
        icon_data_url,
    })
}

#[cfg(not(target_os = "windows"))]
fn parse_gdbus_eval_output(out: &str) -> Option<String> {
    // gdbus Eval returns: (true, '"Firefox"') or (true, '""')
    // Extract inner quoted string
    let start = out.find('"')?;
    let end = out.rfind('"')?;
    if end <= start {
        return None;
    }
    let inner = &out[start + 1..end];
    let s = inner.trim().to_string();
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

#[cfg(not(target_os = "windows"))]
fn capture_wisper_windows() -> Option<OriginTarget> {
    let out = run_cmd_output(
        "gdbus",
        &[
            "call",
            "--session",
            "--dest",
            "org.gnome.Shell",
            "--object-path",
            "/org/gnome/Shell/Extensions/WisperWindows",
            "--method",
            "org.gnome.Shell.Extensions.WisperWindows.List",
        ],
        Duration::from_millis(500),
    )?;
    if out.contains("Error") || out.is_empty() {
        return None;
    }
    // gdbus returns like ('[{"id":123,...}]',) - extract JSON array
    let start = out.find('[')?;
    let end = out.rfind(']')?;
    if end <= start {
        return None;
    }
    let json_str = &out[start..=end];
    let arr: serde_json::Value = serde_json::from_str(json_str).ok()?;
    let list = arr.as_array()?;
    // Prefer focused window; fallback to first non-Wisper if none focused
    let mut focused: Option<&serde_json::Value> = None;
    let mut fallback: Option<&serde_json::Value> = None;
    for win in list {
        let is_wisper = win
            .get("wm_class")
            .and_then(|v| v.as_str())
            .map(|s| s.to_lowercase().contains("wisper"))
            .unwrap_or(false);
        if is_wisper {
            continue;
        }
        if fallback.is_none() {
            fallback = Some(win);
        }
        if win.get("focus").and_then(|v| v.as_bool()) == Some(true) {
            focused = Some(win);
            break;
        }
    }
    let win = focused.or(fallback)?;
    let id = win
        .get("id")
        .and_then(|v| v.as_u64())
        .or_else(|| win.get("id").and_then(|v| v.as_i64()).map(|v| v as u64))?;
    if id == 0 {
        return None;
    }
    let app_id = win
        .get("wm_class")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let title = win
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if app_id.is_empty() && title.is_empty() {
        return None;
    }
    let icon_data_url = icon_with_placeholder(&app_id, &title);
    Some(OriginTarget {
        backend: "wisper".into(),
        addr: id.to_string(),
        app_id,
        title,
        icon_data_url,
    })
}

#[cfg(not(target_os = "windows"))]
fn capture_gnome() -> Option<OriginTarget> {
    // Prefer WisperWindows extension (reliable on Wayland, no Eval block)
    if let Some(t) = capture_wisper_windows() {
        return Some(t);
    }
    let out = run_cmd_output(
        "gdbus",
        &[
            "call",
            "--session",
            "--dest",
            "org.gnome.Shell",
            "--object-path",
            "/org/gnome/Shell",
            "--method",
            "org.gnome.Shell.Eval",
            "global.display.focus_window ? global.display.focus_window.get_wm_class() : \"\"",
        ],
        Duration::from_millis(500),
    )?;
    if out.contains("Error") || out.contains("error") {
        return None;
    }
    let app_id = parse_gdbus_eval_output(&out).unwrap_or_default();
    if app_id.is_empty() {
        return None;
    }
    let title_out = run_cmd_output(
        "gdbus",
        &[
            "call",
            "--session",
            "--dest",
            "org.gnome.Shell",
            "--object-path",
            "/org/gnome/Shell",
            "--method",
            "org.gnome.Shell.Eval",
            "global.display.focus_window ? global.display.focus_window.get_title() : \"\"",
        ],
        Duration::from_millis(500),
    );
    let title = title_out
        .and_then(|o| parse_gdbus_eval_output(&o))
        .unwrap_or_default();
    let icon_data_url = icon_with_placeholder(&app_id, &title);
    // For GNOME activation we store app_id as addr as well (fallback)
    Some(OriginTarget {
        backend: "gnome".into(),
        addr: app_id.clone(),
        app_id: app_id.clone(),
        title,
        icon_data_url,
    })
}

#[cfg(not(target_os = "windows"))]
fn capture_kde() -> Option<OriginTarget> {
    let out = run_cmd_output(
        "qdbus",
        &["org.kde.KWin", "/KWin", "activeWindow"],
        Duration::from_millis(400),
    )
    .or_else(|| {
        run_cmd_output(
            "qdbus-qt6",
            &["org.kde.KWin", "/KWin", "activeWindow"],
            Duration::from_millis(400),
        )
    })?;
    let addr = out.trim().to_string();
    if addr.is_empty() || addr == "0" {
        return None;
    }
    // Try to get resource name
    let app_id = run_cmd_output(
        "qdbus",
        &["org.kde.KWin", &format!("/Windows/{addr}"), "resourceName"],
        Duration::from_millis(300),
    )
    .or_else(|| {
        run_cmd_output(
            "qdbus-qt6",
            &["org.kde.KWin", &format!("/Windows/{addr}"), "resourceName"],
            Duration::from_millis(300),
        )
    })
    .map(|s| s.trim().trim_matches('"').to_string())
    .unwrap_or_default();
    let title = run_cmd_output(
        "qdbus",
        &["org.kde.KWin", &format!("/Windows/{addr}"), "caption"],
        Duration::from_millis(300),
    )
    .or_else(|| {
        run_cmd_output(
            "qdbus-qt6",
            &["org.kde.KWin", &format!("/Windows/{addr}"), "caption"],
            Duration::from_millis(300),
        )
    })
    .map(|s| s.trim().trim_matches('"').to_string())
    .unwrap_or_default();
    let icon_data_url = icon_with_placeholder(&app_id, &title);
    Some(OriginTarget {
        backend: "kde".into(),
        addr,
        app_id,
        title,
        icon_data_url,
    })
}

#[cfg(not(target_os = "windows"))]
fn capture_fallback_x11() -> Option<OriginTarget> {
    let win = run_cmd_output(
        "xprop",
        &["-root", "_NET_ACTIVE_WINDOW"],
        Duration::from_millis(300),
    )?;
    let id = win.split('#').last()?.trim().to_string();
    if id.is_empty() || id == "0x0" {
        return None;
    }
    let props = run_cmd_output(
        "xprop",
        &["-id", &id, "WM_CLASS", "_NET_WM_NAME", "WM_NAME"],
        Duration::from_millis(300),
    )
    .unwrap_or_default();
    let mut app_id = String::new();
    let mut title = String::new();
    for line in props.lines() {
        if line.starts_with("WM_CLASS") {
            if let Some(q) = line.split('"').nth(3).or_else(|| line.split('"').nth(1)) {
                app_id = q.to_string();
            }
        } else if line.starts_with("_NET_WM_NAME") || line.starts_with("WM_NAME") {
            if let Some(q) = line.split('"').nth(1) {
                title = q.to_string();
            }
        }
    }
    if app_id.is_empty() && title.is_empty() {
        app_id = "App".into();
    }
    let icon_data_url = icon_with_placeholder(&app_id, &title);
    Some(OriginTarget {
        backend: "x11-fallback".into(),
        addr: id,
        app_id,
        title,
        icon_data_url,
    })
}

fn placeholder_origin() -> Option<OriginTarget> {
    // Last resort: always return a placeholder so overlay visibly changes
    Some(OriginTarget {
        backend: "placeholder".into(),
        addr: "placeholder".into(),
        app_id: "App".into(),
        title: String::new(),
        icon_data_url: Some(placeholder_data_url("A")),
    })
}

/// macOS origin binding: frontmost app at hotkey press (pid + bundle id) via
/// NSWorkspace. No window titles, no new permissions beyond the Accessibility
/// grant hotkeys already need.
#[cfg(target_os = "macos")]
fn is_self_app(name: &str, bundle: &str) -> bool {
    bundle == "com.taraksh01.wisper"
        || bundle == "com.taraksh01.wisper-dev"
        || name.eq_ignore_ascii_case("wisper")
        || name.eq_ignore_ascii_case("wisper dev")
}

/// App icon as a small PNG data URL for the overlay pill. Goes through the
/// `image` crate (TIFF decode, 64px thumbnail, PNG encode) to avoid unsafe
/// AppKit bitmap calls. None when anything fails — the pill falls back to
/// the initial-letter placeholder.
#[cfg(target_os = "macos")]
fn app_icon_data_url(app: &objc2_app_kit::NSRunningApplication) -> Option<String> {
    let tiff = app.icon()?.TIFFRepresentation()?.to_vec();
    if tiff.is_empty() || tiff.len() > 4 * 1024 * 1024 {
        return None;
    }
    let img = image::load_from_memory(&tiff).ok()?;
    let thumb = img.thumbnail(64, 64);
    let mut cursor = std::io::Cursor::new(Vec::new());
    thumb.write_to(&mut cursor, image::ImageFormat::Png).ok()?;
    let png = cursor.into_inner();
    if png.is_empty() || png.len() > 256 * 1024 {
        return None;
    }
    use base64::Engine as _;
    Some(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(&png)
    ))
}

#[cfg(target_os = "macos")]
fn capture_macos() -> Option<OriginTarget> {
    use objc2_app_kit::NSWorkspace;

    let front = NSWorkspace::sharedWorkspace().frontmostApplication()?;
    let icon_data_url = app_icon_data_url(&front);
    let name = front
        .localizedName()
        .map(|s| s.to_string())
        .unwrap_or_default();
    let bundle = front
        .bundleIdentifier()
        .map(|s| s.to_string())
        .unwrap_or_default();
    let pid = front.processIdentifier();
    eprintln!("[focus] capture: frontmost name={name:?} bundle={bundle:?} pid={pid}");
    if pid <= 0 || is_self_app(&name, &bundle) {
        eprintln!("[focus] capture: skipped (invalid pid or self)");
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
        icon_data_url,
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
fn is_macos_alive(target: &OriginTarget) -> bool {
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
// IgnoringOtherApps is deprecated (no-op) on macOS 14+, but still honored on
// Ventura and older, so keep it and silence the warning.
#[allow(deprecated)]
#[cfg(target_os = "macos")]
fn focus_macos(target: &OriginTarget) -> bool {
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

#[allow(unreachable_code)]
pub fn capture_origin() -> Option<OriginTarget> {
    #[cfg(target_os = "macos")]
    {
        return capture_macos().or_else(placeholder_origin);
    }
    #[cfg(target_os = "windows")]
    {
        return capture_windows().or_else(placeholder_origin);
    }
    #[cfg(not(target_os = "windows"))]
    {
        return capture_origin_unix();
    }
}

#[cfg(not(target_os = "windows"))]
fn capture_origin_unix() -> Option<OriginTarget> {
    // Dispatch on the known compositor instead of spawning every backend tool
    // sequentially (~3s worst case when each blocks to timeout).
    if std::env::var("HYPRLAND_INSTANCE_SIGNATURE").is_ok() {
        return capture_hyprland().or_else(placeholder_origin);
    }
    if std::env::var("SWAYSOCK").is_ok() {
        return capture_sway().or_else(placeholder_origin);
    }
    let desktop = std::env::var("XDG_CURRENT_DESKTOP")
        .unwrap_or_default()
        .to_lowercase();
    let session = crate::paste::detect_session_type();
    if desktop.contains("gnome") {
        if let Some(t) = capture_gnome() {
            return Some(t);
        }
        if session == "x11" {
            if let Some(t) = capture_fallback_x11() {
                return Some(t);
            }
        }
        return placeholder_origin();
    }
    if desktop.contains("kde") {
        if let Some(t) = capture_kde() {
            return Some(t);
        }
        if session == "x11" {
            if let Some(t) = capture_fallback_x11() {
                return Some(t);
            }
        }
        return placeholder_origin();
    }
    if session == "x11" {
        return capture_fallback_x11().or_else(placeholder_origin);
    }
    // Unknown Wayland compositor: full chain as before.
    if let Some(t) = capture_hyprland() {
        return Some(t);
    }
    if let Some(t) = capture_sway() {
        return Some(t);
    }
    if let Some(t) = capture_gnome() {
        return Some(t);
    }
    if let Some(t) = capture_kde() {
        return Some(t);
    }
    if let Some(t) = capture_fallback_x11() {
        return Some(t);
    }
    placeholder_origin()
}

#[cfg(target_os = "windows")]
fn windows_icon_data_url(hwnd: windows::Win32::Foundation::HWND) -> Option<String> {
    use windows::Win32::Foundation::WPARAM;
    use windows::Win32::Graphics::Gdi::{
        CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits,
        ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        DrawIconEx, GetClassLongPtrW, GetSystemMetrics, SendMessageW, DI_NORMAL, GCLP_HICON,
        GCLP_HICONSM, HICON, ICON_BIG, ICON_SMALL, SM_CXICON, SM_CYICON, WM_GETICON,
    };

    let hicon = unsafe {
        let big = SendMessageW(hwnd, WM_GETICON, Some(WPARAM(ICON_BIG as usize)), None);
        if !HICON(big.0 as _).is_invalid() {
            HICON(big.0 as _)
        } else {
            let small = SendMessageW(hwnd, WM_GETICON, Some(WPARAM(ICON_SMALL as usize)), None);
            if !HICON(small.0 as _).is_invalid() {
                HICON(small.0 as _)
            } else {
                let cls = GetClassLongPtrW(hwnd, GCLP_HICON);
                if cls != 0 {
                    HICON(cls as _)
                } else {
                    let cls_sm = GetClassLongPtrW(hwnd, GCLP_HICONSM);
                    if cls_sm == 0 {
                        return None;
                    }
                    HICON(cls_sm as _)
                }
            }
        }
    };
    if hicon.is_invalid() {
        return None;
    }
    let w = unsafe { GetSystemMetrics(SM_CXICON) }.clamp(16, 64);
    let h = unsafe { GetSystemMetrics(SM_CYICON) }.clamp(16, 64);
    if w <= 0 || h <= 0 {
        return None;
    }
    unsafe {
        let screen = GetDC(None);
        if screen.is_invalid() {
            return None;
        }
        let mem = CreateCompatibleDC(Some(screen));
        if mem.is_invalid() {
            ReleaseDC(None, screen);
            return None;
        }
        let bmp = CreateCompatibleBitmap(screen, w, h);
        if bmp.is_invalid() {
            let _ = DeleteDC(mem);
            ReleaseDC(None, screen);
            return None;
        }
        let old = SelectObject(mem, bmp.into());
        let drawn = DrawIconEx(mem, 0, 0, hicon, w, h, 0, None, DI_NORMAL).is_ok();
        SelectObject(mem, old);
        let out = if drawn {
            let mut bmi: BITMAPINFO = std::mem::zeroed();
            bmi.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
            bmi.bmiHeader.biWidth = w;
            bmi.bmiHeader.biHeight = -h;
            bmi.bmiHeader.biPlanes = 1;
            bmi.bmiHeader.biBitCount = 32;
            bmi.bmiHeader.biCompression = BI_RGB.0;
            let mut pixels = vec![0u8; w as usize * 4 * h as usize];
            let lines = GetDIBits(
                mem,
                bmp,
                0,
                h as u32,
                Some(pixels.as_mut_ptr() as *mut std::ffi::c_void),
                &mut bmi,
                DIB_RGB_COLORS,
            );
            if lines == 0 {
                None
            } else {
                for px in pixels.chunks_exact_mut(4) {
                    let b = px[0];
                    px[0] = px[2];
                    px[2] = b;
                }
                image::RgbaImage::from_raw(w as u32, h as u32, pixels)
                    .and_then(|img| {
                        let mut cursor = std::io::Cursor::new(Vec::new());
                        image::DynamicImage::ImageRgba8(img)
                            .write_to(&mut cursor, image::ImageFormat::Png)
                            .ok()
                            .map(|_| cursor.into_inner())
                    })
                    .map(|png| {
                        use base64::Engine as _;
                        format!(
                            "data:image/png;base64,{}",
                            base64::engine::general_purpose::STANDARD.encode(&png)
                        )
                    })
            }
        } else {
            None
        };
        let _ = DeleteObject(bmp.into());
        let _ = DeleteDC(mem);
        ReleaseDC(None, screen);
        out
    }
}

#[cfg(target_os = "windows")]
fn capture_windows() -> Option<OriginTarget> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowTextW, IsWindow};
    let hwnd = unsafe { GetForegroundWindow() };
    if hwnd.0.is_null() || !unsafe { IsWindow(Some(hwnd)) }.as_bool() {
        return None;
    }
    let mut pid: u32 = 0;
    unsafe {
        windows::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId(
            hwnd,
            Some(&mut pid as *mut u32),
        )
    };
    if pid == 0 {
        return None;
    }
    let mut app_id = String::from("App");
    if let Ok(h) = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) } {
        let mut buf = [0u16; 260];
        let mut len = buf.len() as u32;
        if unsafe {
            QueryFullProcessImageNameW(
                h,
                PROCESS_NAME_WIN32,
                windows::core::PWSTR(buf.as_mut_ptr()),
                &mut len,
            )
        }
        .is_ok()
        {
            let path = String::from_utf16_lossy(&buf[..len as usize]);
            if let Some(stem) = std::path::Path::new(&path)
                .file_stem()
                .and_then(|s| s.to_str())
            {
                if !stem.is_empty() {
                    app_id = stem.to_string();
                }
            }
        }
        let _ = unsafe { CloseHandle(h) };
    }
    if app_id.eq_ignore_ascii_case("wisper") {
        return None;
    }
    let mut buf = [0u16; 512];
    let title = {
        let n = unsafe { GetWindowTextW(hwnd, &mut buf) };
        if n > 0 {
            String::from_utf16_lossy(&buf[..n as usize])
                .trim()
                .to_string()
        } else {
            String::new()
        }
    };
    if app_id == "App" && title.is_empty() {
        return None;
    }
    // Prefer the live window icon; fall back to the initial-letter placeholder.
    let icon_data_url =
        windows_icon_data_url(hwnd).or_else(|| icon_with_placeholder(&app_id, &title));
    Some(OriginTarget {
        backend: "windows".into(),
        addr: (hwnd.0 as usize).to_string(),
        app_id,
        title,
        icon_data_url,
    })
}

#[cfg(target_os = "windows")]
fn parse_hwnd(addr: &str) -> Option<windows::Win32::Foundation::HWND> {
    use windows::Win32::Foundation::HWND;
    let n: usize = addr.parse().ok()?;
    if n == 0 {
        return None;
    }
    Some(HWND(n as *mut std::ffi::c_void))
}

#[cfg(target_os = "windows")]
fn focus_windows(target: &OriginTarget) -> bool {
    use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
    use windows::Win32::UI::WindowsAndMessaging::{
        BringWindowToTop, GetForegroundWindow, GetWindowThreadProcessId, IsIconic, IsWindow,
        SetForegroundWindow, ShowWindow, SW_RESTORE, SW_SHOW,
    };
    let hwnd = match parse_hwnd(&target.addr) {
        Some(h) => h,
        None => return false,
    };
    if !unsafe { IsWindow(Some(hwnd)) }.as_bool() {
        return false;
    }
    if unsafe { IsIconic(hwnd) }.as_bool() {
        let _ = unsafe { ShowWindow(hwnd, SW_RESTORE) };
    }
    if (unsafe { GetForegroundWindow() }) == hwnd {
        return true;
    }
    // Background apps cannot steal foreground with a bare SetForegroundWindow
    // call (foreground lock) — attach our input to the foreground thread and
    // the target thread first, then bring the target on top.
    let our_tid = unsafe { GetCurrentThreadId() };
    let target_tid = unsafe { GetWindowThreadProcessId(hwnd, None) };
    let fore_hwnd = unsafe { GetForegroundWindow() };
    let fore_tid = if fore_hwnd.0.is_null() {
        0
    } else {
        unsafe { GetWindowThreadProcessId(fore_hwnd, None) }
    };
    let attached_fore = fore_tid != 0
        && fore_tid != our_tid
        && unsafe { AttachThreadInput(fore_tid, our_tid, true) }.as_bool();
    let attached_target = target_tid != 0
        && target_tid != our_tid
        && unsafe { AttachThreadInput(our_tid, target_tid, true) }.as_bool();
    let _ = unsafe { BringWindowToTop(hwnd) };
    let _ = unsafe { ShowWindow(hwnd, SW_SHOW) };
    let _ = unsafe { SetForegroundWindow(hwnd) };
    if attached_target {
        let _ = unsafe { AttachThreadInput(our_tid, target_tid, false) };
    }
    if attached_fore {
        let _ = unsafe { AttachThreadInput(fore_tid, our_tid, false) };
    }
    // Second attempt once detached — the lock is often granted on retry.
    let _ = unsafe { SetForegroundWindow(hwnd) };
    let start = std::time::Instant::now();
    while start.elapsed() < Duration::from_millis(500) {
        if (unsafe { GetForegroundWindow() }) == hwnd {
            return true;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    (unsafe { GetForegroundWindow() }) == hwnd
}

pub fn focus_origin(target: &OriginTarget) -> bool {
    match target.backend.as_str() {
        "hyprland" => run_cmd_status(
            "hyprctl",
            &[
                "dispatch",
                "focuswindow",
                &format!("address:{}", target.addr),
            ],
            Duration::from_millis(600),
        ),
        "sway" => run_cmd_status(
            "swaymsg",
            &[&format!("[con_id=\"{}\"] focus", target.addr)],
            Duration::from_millis(600),
        ),
        "wisper" => {
            let winid: u32 = target.addr.parse().unwrap_or(0);
            if winid == 0 {
                return false;
            }
            run_cmd_status(
                "gdbus",
                &[
                    "call",
                    "--session",
                    "--dest",
                    "org.gnome.Shell",
                    "--object-path",
                    "/org/gnome/Shell/Extensions/WisperWindows",
                    "--method",
                    "org.gnome.Shell.Extensions.WisperWindows.Activate",
                    &winid.to_string(),
                ],
                Duration::from_millis(600),
            )
        }
        "gnome" => {
            // Try WisperWindows by app_id lookup first if addr is not numeric
            if let Ok(winid) = target.addr.parse::<u32>() {
                if winid != 0
                    && run_cmd_status(
                        "gdbus",
                        &[
                            "call",
                            "--session",
                            "--dest",
                            "org.gnome.Shell",
                            "--object-path",
                            "/org/gnome/Shell/Extensions/WisperWindows",
                            "--method",
                            "org.gnome.Shell.Extensions.WisperWindows.Activate",
                            &winid.to_string(),
                        ],
                        Duration::from_millis(600),
                    )
                {
                    return true;
                }
            }
            let esc = target
                .app_id
                .replace('\\', "\\\\")
                .replace('"', "\\\"")
                .replace('\n', "\\n");
            let script = format!(
                "(function(){{ let ws=global.workspace_manager.get_active_workspace(); let actors=global.get_window_actors(); for(let a of actors){{ let w=a.meta_window; if(w && w.get_wm_class()==\"{esc}\" ){{ w.activate(global.get_current_time()); return true; }} }} let apps=Shell.AppSystem.get_default().lookup_app(\"{esc}\"); if(apps){{ apps.activate(); return true; }} return false; }})()"
            );
            run_cmd_status(
                "gdbus",
                &[
                    "call",
                    "--session",
                    "--dest",
                    "org.gnome.Shell",
                    "--object-path",
                    "/org/gnome/Shell",
                    "--method",
                    "org.gnome.Shell.Eval",
                    &script,
                ],
                Duration::from_millis(600),
            )
        }
        "kde" => {
            run_cmd_status(
                "qdbus",
                &["org.kde.KWin", "/KWin", "activateWindow", &target.addr],
                Duration::from_millis(600),
            ) || run_cmd_status(
                "qdbus-qt6",
                &["org.kde.KWin", "/KWin", "activateWindow", &target.addr],
                Duration::from_millis(600),
            )
        }
        "x11-fallback" => {
            // X11: prefer native tools that are often present, then Wisper extension as fallback
            if run_cmd_status(
                "xdotool",
                &["windowactivate", &target.addr],
                Duration::from_millis(600),
            ) {
                return true;
            }
            if run_cmd_status(
                "wmctrl",
                &["-i", "-a", &target.addr],
                Duration::from_millis(600),
            ) {
                return true;
            }
            // Same shell extension works on X11 GNOME too — no extra deps
            if let Ok(winid) = target.addr.parse::<u32>() {
                if winid != 0
                    && run_cmd_status(
                        "gdbus",
                        &[
                            "call",
                            "--session",
                            "--dest",
                            "org.gnome.Shell",
                            "--object-path",
                            "/org/gnome/Shell/Extensions/WisperWindows",
                            "--method",
                            "org.gnome.Shell.Extensions.WisperWindows.Activate",
                            &winid.to_string(),
                        ],
                        Duration::from_millis(600),
                    )
                {
                    return true;
                }
            }
            // Last try: raise via xprop-style (wmctrl without -i already tried)
            false
        }
        #[cfg(target_os = "windows")]
        "windows" => focus_windows(target),
        #[cfg(target_os = "macos")]
        "macos" => focus_macos(target),
        _ => false,
    }
}

fn is_gnome_shell() -> bool {
    let out = run_cmd_output("gnome-shell", &["--version"], Duration::from_millis(500))
        .unwrap_or_default();
    out.to_lowercase().contains("gnome shell")
}

fn extension_user_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|h| {
        h.join(".local/share/gnome-shell/extensions")
            .join(WISPER_GNOME_EXT_UUID)
    })
}

fn bundled_extension_dir() -> Option<PathBuf> {
    // Dev layout (cargo run / tauri dev): src-tauri/resources/...
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources/gnome-shell")
        .join(WISPER_GNOME_EXT_UUID);
    if manifest.join("extension.js").is_file() {
        return Some(manifest);
    }
    // Prod layout: resources next to the binary (AppImage / deb).
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            for cand in [
                dir.join("resources/gnome-shell")
                    .join(WISPER_GNOME_EXT_UUID),
                dir.join("../resources/gnome-shell")
                    .join(WISPER_GNOME_EXT_UUID),
                dir.join("gnome-shell").join(WISPER_GNOME_EXT_UUID),
            ] {
                if cand.join("extension.js").is_file() {
                    return Some(cand);
                }
            }
        }
    }
    for cand in [
        PathBuf::from("/usr/lib/wisper/resources/gnome-shell").join(WISPER_GNOME_EXT_UUID),
        PathBuf::from("/usr/share/wisper/resources/gnome-shell").join(WISPER_GNOME_EXT_UUID),
    ] {
        if cand.join("extension.js").is_file() {
            return Some(cand);
        }
    }
    None
}

fn is_extension_installed() -> bool {
    extension_user_dir()
        .map(|d| d.join("extension.js").is_file())
        .unwrap_or(false)
}

fn is_extension_enabled_in_settings() -> bool {
    let out = run_cmd_output(
        "gsettings",
        &["get", "org.gnome.shell", "enabled-extensions"],
        Duration::from_millis(500),
    )
    .unwrap_or_default();
    out.contains(WISPER_GNOME_EXT_UUID)
}

fn is_extension_active() -> bool {
    let out = run_cmd_output(
        "gdbus",
        &[
            "call",
            "--session",
            "--dest",
            "org.gnome.Shell",
            "--object-path",
            "/org/gnome/Shell/Extensions/WisperWindows",
            "--method",
            "org.gnome.Shell.Extensions.WisperWindows.List",
        ],
        Duration::from_millis(500),
    )
    .unwrap_or_default();
    if out.is_empty() || out.contains("Error") {
        return false;
    }
    let (Some(start), Some(end)) = (out.find('['), out.rfind(']')) else {
        return false;
    };
    if end <= start {
        return false;
    }
    serde_json::from_str::<serde_json::Value>(&out[start..=end])
        .ok()
        .and_then(|v| v.as_array().cloned())
        .is_some()
}

pub fn get_origin_environment() -> OriginEnvironment {
    let session_type = crate::paste::detect_session_type();
    let is_gnome = is_gnome_shell();
    let needs_extension = session_type == "wayland" && is_gnome;
    let installed = is_extension_installed();
    let enabled_in_settings = is_extension_enabled_in_settings();
    let active = if needs_extension {
        is_extension_active()
    } else {
        // No helper needed elsewhere — native paths (xprop / hyprctl / swaymsg / qdbus) apply.
        // Still report active if the helper happens to be present.
        is_extension_active()
    };
    let ready = if needs_extension { active } else { true };
    let needs_relogin = needs_extension && installed && enabled_in_settings && !active;
    OriginEnvironment {
        session_type,
        is_gnome,
        needs_extension,
        installed,
        enabled_in_settings,
        active,
        ready,
        needs_relogin,
    }
}

pub fn is_origin_alive(target: &OriginTarget) -> bool {
    match target.backend.as_str() {
        "placeholder" => false,
        #[cfg(target_os = "macos")]
        "macos" => is_macos_alive(target),
        #[cfg(target_os = "windows")]
        "windows" => match parse_hwnd(&target.addr) {
            Some(hwnd) => unsafe {
                windows::Win32::UI::WindowsAndMessaging::IsWindow(Some(hwnd)).as_bool()
            },
            None => false,
        },
        "wisper" => {
            let Ok(id) = target.addr.parse::<u64>() else {
                return true;
            };
            if id == 0 {
                return false;
            }
            let out = run_cmd_output(
                "gdbus",
                &[
                    "call",
                    "--session",
                    "--dest",
                    "org.gnome.Shell",
                    "--object-path",
                    "/org/gnome/Shell/Extensions/WisperWindows",
                    "--method",
                    "org.gnome.Shell.Extensions.WisperWindows.List",
                ],
                Duration::from_millis(500),
            )
            .unwrap_or_default();
            if out.is_empty() || out.contains("Error") {
                return true;
            }
            let Some(start) = out.find('[') else {
                return true;
            };
            let Some(end) = out.rfind(']') else {
                return true;
            };
            if end <= start {
                return true;
            }
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&out[start..=end]) {
                if let Some(arr) = v.as_array() {
                    for win in arr {
                        let win_id = win
                            .get("id")
                            .and_then(|v| v.as_u64())
                            .or_else(|| win.get("id").and_then(|v| v.as_i64()).map(|v| v as u64))
                            .unwrap_or(0);
                        if win_id == id {
                            return true;
                        }
                    }
                    return false;
                }
            }
            true
        }
        "hyprland" => {
            let Some(out) =
                run_cmd_output("hyprctl", &["clients", "-j"], Duration::from_millis(500))
            else {
                return true;
            };
            let Ok(v) = serde_json::from_str::<serde_json::Value>(&out) else {
                return true;
            };
            let Some(arr) = v.as_array() else {
                return true;
            };
            for win in arr {
                if win.get("address").and_then(|x| x.as_str()).unwrap_or("") == target.addr {
                    return true;
                }
            }
            false
        }
        "sway" => {
            let Some(out) =
                run_cmd_output("swaymsg", &["-t", "get_tree"], Duration::from_millis(500))
            else {
                return true;
            };
            let Ok(v) = serde_json::from_str::<serde_json::Value>(&out) else {
                return true;
            };
            // Reuse find_focused_sway traversal but check any id match
            fn contains_id(node: &serde_json::Value, want: &str) -> bool {
                if node
                    .get("id")
                    .and_then(|v| v.as_i64())
                    .map(|v| v.to_string())
                    == Some(want.to_string())
                {
                    return true;
                }
                for key in &["nodes", "floating_nodes"] {
                    if let Some(arr) = node.get(*key).and_then(|v| v.as_array()) {
                        for child in arr {
                            if contains_id(child, want) {
                                return true;
                            }
                        }
                    }
                }
                false
            }
            if contains_id(&v, &target.addr) {
                return true;
            }
            false
        }
        "x11-fallback" => {
            // xprop -id succeeds only if window still exists
            run_cmd_status("xprop", &["-id", &target.addr], Duration::from_millis(300))
        }
        _ => true,
    }
}

pub fn ensure_gnome_extension() -> Result<OriginEnvironment, String> {
    let Some(ext_dir) = extension_user_dir() else {
        return Err("Could not locate home directory".into());
    };
    let Some(bundled) = bundled_extension_dir() else {
        return Err("Bundled helper not found in this install".into());
    };
    std::fs::create_dir_all(&ext_dir)
        .map_err(|e| format!("Could not create {}: {e}", ext_dir.display()))?;
    // Refuse to install through a symlink (attacker-planted link would redirect
    // our write to an arbitrary file). Check after create_dir_all since it follows links.
    if std::fs::symlink_metadata(&ext_dir)
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Err(format!(
            "Refusing to install through symlink: {}",
            ext_dir.display()
        ));
    }
    for name in ["extension.js", "metadata.json"] {
        let data = std::fs::read(bundled.join(name))
            .map_err(|e| format!("Missing {name} in bundle: {e}"))?;
        let dest = ext_dir.join(name);
        if std::fs::symlink_metadata(&dest)
            .map(|m| m.file_type().is_symlink())
            .unwrap_or(false)
        {
            return Err(format!("Refusing to overwrite symlink: {}", dest.display()));
        }
        std::fs::write(&dest, data)
            .map_err(|e| format!("Could not write {}: {e}", dest.display()))?;
    }
    // Best-effort enable: per-user only, no sudo.
    let current = run_cmd_output(
        "gsettings",
        &["get", "org.gnome.shell", "enabled-extensions"],
        Duration::from_millis(500),
    )
    .unwrap_or_else(|| "[]".to_string());
    if !current.contains(WISPER_GNOME_EXT_UUID) {
        let next = {
            let trimmed = current.trim();
            if trimmed.starts_with('[') && trimmed.ends_with(']') && trimmed.len() >= 2 {
                let inner = trimmed[1..trimmed.len() - 1].trim();
                if inner.is_empty() {
                    format!("['{WISPER_GNOME_EXT_UUID}']")
                } else {
                    format!("[{inner}, '{WISPER_GNOME_EXT_UUID}']")
                }
            } else {
                format!("['{WISPER_GNOME_EXT_UUID}']")
            }
        };
        run_cmd_status(
            "gsettings",
            &["set", "org.gnome.shell", "enabled-extensions", &next],
            Duration::from_millis(500),
        );
    }
    run_cmd_status(
        "gnome-extensions",
        &["enable", WISPER_GNOME_EXT_UUID],
        Duration::from_millis(800),
    );
    Ok(get_origin_environment())
}
