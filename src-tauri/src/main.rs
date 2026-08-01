// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // WebKitGTK aborts with "Could not create default EGL display: EGL_BAD_PARAMETER"
    // on some Linux setups (NVIDIA GPUs, VMs). Disable accelerated compositing
    // so the window always renders. See tauri-apps/tauri#9394.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").is_none() {
        std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
    }

    wisper_lib::run()
}
