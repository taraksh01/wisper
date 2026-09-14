use std::path::{Path, PathBuf};
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
            if let Some(q) = line.split('"').nth(1) {
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

pub fn capture_origin() -> Option<OriginTarget> {
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
    // Last resort: always return a placeholder so overlay visibly changes
    Some(OriginTarget {
        backend: "placeholder".into(),
        addr: "placeholder".into(),
        app_id: "App".into(),
        title: String::new(),
        icon_data_url: Some(placeholder_data_url("A")),
    })
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
            let script = format!(
                "global.display.focus_window && global.display.focus_window.get_wm_class()==\"{}\" && global.display.focus_window.activate(global.get_current_time())",
                target.app_id.replace('"', "\\\"")
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
    if target.backend == "wisper" {
        if let Ok(id) = target.addr.parse::<u64>() {
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
            return true;
        }
    }
    true
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
    for name in ["extension.js", "metadata.json"] {
        let data = std::fs::read(bundled.join(name))
            .map_err(|e| format!("Missing {name} in bundle: {e}"))?;
        std::fs::write(ext_dir.join(name), data)
            .map_err(|e| format!("Could not write {}: {e}", ext_dir.join(name).display()))?;
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
