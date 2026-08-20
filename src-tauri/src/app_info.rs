/// Central app identity helpers — dynamic by build profile.
///
/// - Debug (tauri dev / cargo run): wisper-dev (so it doesn't clobber prod data)
/// - Release (tauri build / cargo build --release): wisper
///
/// Static strings only so env! / tauri identifier assumptions elsewhere stay safe.
/// Data dirs + overlay/window titles derive from these, so both apps can run side-by-side.

/// "wisper" in release, "wisper-dev" in debug. Used for data/config subdirs.
pub fn data_dir_name() -> &'static str {
    if cfg!(debug_assertions) {
        "wisper-dev"
    } else {
        "wisper"
    }
}

/// Logical app display name matching the data dir. Mirrors productName/identifier.
pub fn display_name() -> &'static str {
    if cfg!(debug_assertions) {
        "Wisper Dev"
    } else {
        "Wisper"
    }
}

pub fn is_dev() -> bool {
    cfg!(debug_assertions)
}

pub fn overlay_url() -> &'static str {
    if cfg!(debug_assertions) {
        "overlay-dev.html"
    } else {
        "overlay.html"
    }
}

pub fn overlay_css() -> &'static str {
    if cfg!(debug_assertions) {
        "overlay-dev.css"
    } else {
        "overlay.css"
    }
}

pub fn favicon_path() -> &'static str {
    if cfg!(debug_assertions) {
        "/dev/wisper-dev.svg"
    } else {
        "/wisper.svg"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dir_matches_display() {
        let d = data_dir_name();
        let n = display_name();
        if d == "wisper-dev" {
            assert_eq!(n, "Wisper Dev");
        } else {
            assert_eq!(n, "Wisper");
        }
    }
}
