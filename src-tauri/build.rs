fn main() {
    // Force a rebuild whenever the Tauri CLI's merged config changes (the CLI
    // passes the merged JSON via TAURI_CONFIG when --config is used). Without
    // this, switching between `tauri dev` and `tauri:dev` (different --config)
    // reuses a stale binary with the wrong identifier / productName / etc.
    println!("cargo:rerun-if-env-changed=TAURI_CONFIG");
    tauri_build::build();
    // Runtime desktop-file pin is in src/lib.rs:write_wisper_desktop_file() — build.rs
    // can't know current_exe reliably at compile time.
}
