use futures_util::StreamExt;
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

// Per-model cancel flags — allows concurrent downloads without canceling others.
static ACTIVE_CANCEL: once_cell::sync::Lazy<
    Mutex<std::collections::HashMap<String, Arc<AtomicBool>>>,
> = once_cell::sync::Lazy::new(|| Mutex::new(std::collections::HashMap::new()));

pub fn get_models_dir() -> PathBuf {
    let mut path = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
    path.push(crate::app_info::data_dir_name());
    path.push("models");
    let _ = fs::create_dir_all(&path);
    path
}

#[tauri::command]
pub fn list_local_models() -> Vec<String> {
    let dir = get_models_dir();
    let mut models = Vec::new();
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if let Ok(file_type) = entry.file_type() {
                if file_type.is_dir()
                    && (name.starts_with("parakeet-")
                        || name.starts_with("indicconformer-")
                        || name.starts_with("moonshine-"))
                {
                    // Family-appropriate marker: parakeet is a directory bundle,
                    // indic uses model.onnx, moonshine uses encoder_model.onnx
                    let path = entry.path();
                    let complete = name.starts_with("parakeet-")
                        || path.join("model.onnx").exists()
                        || path.join("encoder_model.onnx").exists();
                    if complete {
                        models.push(name);
                    }
                }
            }
        }
    }
    models
}

pub fn download_url(model_name: &str) -> Option<String> {
    let url = match model_name {
        "parakeet-onnx-tdt-0.6b-v3" => "https://blob.handy.computer/parakeet-v3-int8.tar.gz",
        "parakeet-onnx-tdt-0.6b-v2" => "https://blob.handy.computer/parakeet-v2-int8.tar.gz",
        "indicconformer-120m-hi" => "https://huggingface.co/parismitaglobalsolutions/indicconformer-sherpa-onnx/resolve/main/hi/model.int8.onnx",
        "indicconformer-120m-bn" => "https://huggingface.co/parismitaglobalsolutions/indicconformer-sherpa-onnx/resolve/main/bn/model.int8.onnx",
        "indicconformer-120m-ta" => "https://huggingface.co/parismitaglobalsolutions/indicconformer-sherpa-onnx/resolve/main/ta/model.int8.onnx",
        "indicconformer-120m-te" => "https://huggingface.co/parismitaglobalsolutions/indicconformer-sherpa-onnx/resolve/main/te/model.int8.onnx",
        "indicconformer-120m-mr" => "https://huggingface.co/parismitaglobalsolutions/indicconformer-sherpa-onnx/resolve/main/mr/model.int8.onnx",
        "indicconformer-120m-gu" => "https://huggingface.co/parismitaglobalsolutions/indicconformer-sherpa-onnx/resolve/main/gu/model.int8.onnx",
        "indicconformer-120m-kn" => "https://huggingface.co/parismitaglobalsolutions/indicconformer-sherpa-onnx/resolve/main/kn/model.int8.onnx",
        "indicconformer-120m-ml" => "https://huggingface.co/parismitaglobalsolutions/indicconformer-sherpa-onnx/resolve/main/ml/model.int8.onnx",
        "indicconformer-120m-pa" => "https://huggingface.co/parismitaglobalsolutions/indicconformer-sherpa-onnx/resolve/main/pa/model.int8.onnx",
        "indicconformer-8lang" => "https://huggingface.co/meetsync/indic-conformer-onnx-sherpa/resolve/main/model.int8.onnx",
        "moonshine-base" => "https://blob.handy.computer/moonshine-base.tar.gz",
        _ => return None,
    };
    Some(url.to_string())
}

fn onnx_dir_name(model_name: &str) -> Option<String> {
    match model_name {
        "parakeet-onnx-tdt-0.6b-v3" => Some("parakeet-tdt-0.6b-v3-int8".into()),
        "parakeet-onnx-tdt-0.6b-v2" => Some("parakeet-tdt-0.6b-v2-int8".into()),
        "indicconformer-120m-hi" => Some("indicconformer-120m-hi".into()),
        "indicconformer-120m-bn" => Some("indicconformer-120m-bn".into()),
        "indicconformer-120m-ta" => Some("indicconformer-120m-ta".into()),
        "indicconformer-120m-te" => Some("indicconformer-120m-te".into()),
        "indicconformer-120m-mr" => Some("indicconformer-120m-mr".into()),
        "indicconformer-120m-gu" => Some("indicconformer-120m-gu".into()),
        "indicconformer-120m-kn" => Some("indicconformer-120m-kn".into()),
        "indicconformer-120m-ml" => Some("indicconformer-120m-ml".into()),
        "indicconformer-120m-pa" => Some("indicconformer-120m-pa".into()),
        "indicconformer-8lang" => Some("indicconformer-8lang".into()),
        "moonshine-base" => Some("moonshine-base".into()),
        _ => None,
    }
}

struct ClearGuard(String);
impl Drop for ClearGuard {
    fn drop(&mut self) {
        ACTIVE_CANCEL
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&self.0);
    }
}

#[tauri::command]
pub async fn download_model(app_handle: AppHandle, model_name: String) -> Result<String, String> {
    let cancel = Arc::new(AtomicBool::new(false));
    ACTIVE_CANCEL
        .lock()
        .unwrap()
        .insert(model_name.clone(), cancel.clone());
    let _clear_guard = ClearGuard(model_name.clone());

    let url = download_url(&model_name).ok_or_else(|| format!("Unknown model: {}.", model_name))?;

    let models_dir = get_models_dir();

    let dir_name = onnx_dir_name(&model_name).ok_or("Missing directory name for ONNX model")?;
    let target_dir = models_dir.join(&dir_name);
    if target_dir.exists() {
        ACTIVE_CANCEL
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&model_name);
        return Ok(target_dir.to_string_lossy().to_string());
    }

    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let ext = if url.ends_with(".onnx") {
        "onnx"
    } else if url.ends_with(".tar.gz") {
        "tar.gz"
    } else {
        "bin"
    };
    let temp_archive =
        std::env::temp_dir().join(format!("wisper_{}_{}.{}", &model_name, nanos, ext));

    let client = reqwest::Client::new();
    let response = client.get(&url).send().await.map_err(|e| e.to_string())?;
    let total = response.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;
    #[allow(unused_mut)]
    let mut file: fs::File = {
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            std::fs::OpenOptions::new()
                .create(true)
                .write(true)
                .truncate(true)
                .mode(0o600)
                .open(&temp_archive)
                .map_err(|e| e.to_string())?
        }
        #[cfg(not(unix))]
        {
            fs::File::create(&temp_archive).map_err(|e| e.to_string())?
        }
    };

    let mut stream = response.bytes_stream();
    let mut last_emitted = 0u32;
    let start = std::time::Instant::now();

    while let Some(chunk_result) = stream.next().await {
        if cancel.load(Ordering::Relaxed) {
            let _ = fs::remove_file(&temp_archive);
            ACTIVE_CANCEL
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .remove(&model_name);
            let _ = app_handle.emit(
                "download-canceled",
                serde_json::json!({ "model": &model_name }),
            );
            return Err("Download canceled".into());
        }
        let chunk = chunk_result.map_err(|e| e.to_string())?;
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;

        let elapsed = start.elapsed().as_secs_f64();
        let speed_bps = if elapsed > 0.0 {
            downloaded as f64 / elapsed
        } else {
            0.0
        };
        if total > 0 {
            let pct = (downloaded as f64 / total as f64 * 100.0) as u32;
            if pct >= last_emitted + 1 || pct == 100 {
                last_emitted = pct;
                let _ = app_handle.emit(
                    "download-progress",
                    serde_json::json!({
                        "model": &model_name,
                        "progress": pct,
                        "speed_bps": speed_bps as u64,
                        "downloaded": downloaded,
                        "total": total,
                    }),
                );
            }
        } else if downloaded % (512 * 1024) < 8192 {
            // For unknown total, emit periodically
            let _ = app_handle.emit(
                "download-progress",
                serde_json::json!({
                    "model": &model_name,
                    "progress": 0,
                    "speed_bps": speed_bps as u64,
                    "downloaded": downloaded,
                    "total": total,
                }),
            );
        }
    }

    // Handle single ONNX file vs tar.gz archive
    if ext == "onnx" {
        // Single file model (e.g., IndicConformer, Moonshine) — just move into target_dir
        let _ = fs::create_dir_all(&target_dir);
        let dest = target_dir.join("model.onnx");
        fs::copy(&temp_archive, &dest).map_err(|e| format!("Failed to save model: {}", e))?;
        let _ = fs::remove_file(&temp_archive);
        // For IndicConformer, also fetch tokens.txt / vocab.json for sherpa
        if model_name.starts_with("indicconformer-") {
            if let Err(e) = fetch_indic_assets(&target_dir, &model_name).await {
                eprintln!("[models] asset fetch failed for {}: {}", model_name, e);
                return Err(format!(
                    "Model downloaded but language data failed: {}. Use 'Install language data' on the model card to retry.",
                    e
                ));
            }
        }
    } else {
        // Extract archive with path traversal validation
        let archive_file = fs::File::open(&temp_archive).map_err(|e| e.to_string())?;
        let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(archive_file));
        for entry in archive
            .entries()
            .map_err(|e| format!("Failed to read archive: {}", e))?
        {
            let entry = entry.map_err(|e| format!("Bad archive entry: {}", e))?;
            if matches!(entry.link_name(), Ok(Some(_))) {
                return Err("Archive contains symlink".into());
            }
            let path = entry.path().map_err(|e| format!("Bad entry path: {}", e))?;
            if path.is_absolute()
                || path
                    .components()
                    .any(|c| matches!(c, std::path::Component::ParentDir))
            {
                return Err("Archive contains invalid path".into());
            }
            let dest = models_dir.join(&path);
            if !dest.starts_with(&models_dir) {
                return Err("Archive path escapes models dir".into());
            }
        }
        // Re-open and unpack after validation (entries consumed above)
        let archive_file = fs::File::open(&temp_archive).map_err(|e| e.to_string())?;
        let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(archive_file));
        archive
            .unpack(&models_dir)
            .map_err(|e| format!("Failed to extract model: {}", e))?;
        if !models_dir
            .canonicalize()
            .unwrap_or_else(|_| models_dir.clone())
            .exists()
        {
            return Err("Models dir missing after unpack".into());
        }
        let _ = fs::remove_file(&temp_archive);
    }

    Ok(target_dir.to_string_lossy().to_string())
}

#[tauri::command]
pub fn cancel_download(model_name: String) {
    if let Some(flag) = ACTIVE_CANCEL
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(&model_name)
    {
        flag.store(true, Ordering::Relaxed);
    }
}

#[tauri::command]
pub fn delete_model(model_name: String) -> Result<(), String> {
    if model_name.contains('/') || model_name.contains('\\') || model_name.contains("..") {
        return Err("Invalid model name".to_string());
    }
    if !(model_name.starts_with("parakeet-")
        || model_name.starts_with("indicconformer-")
        || model_name.starts_with("moonshine-"))
    {
        return Err("Invalid model name prefix".to_string());
    }
    let models_dir = get_models_dir();
    let canonical_base = models_dir.canonicalize().unwrap_or(models_dir.clone());
    let path = models_dir.join(&model_name);
    let canonical_path = path.canonicalize().unwrap_or(path.clone());
    if !canonical_path.starts_with(&canonical_base) {
        return Err("Invalid model path".to_string());
    }
    if !path.exists() {
        return Err(format!("Model '{}' not found", model_name));
    }
    if path.is_dir() {
        fs::remove_dir_all(&path).map_err(|e| format!("Failed to delete model: {}", e))
    } else {
        fs::remove_file(&path).map_err(|e| format!("Failed to delete model: {}", e))
    }
}

/// Fetch tokens.txt for an IndicConformer model into its directory.
/// parismita repo: shared tokens.txt at repo root (all Indic languages).
/// sulabhkatiyar fallback: vocab.json next to the model, converted by the engine.
pub async fn fetch_indic_assets(
    target_dir: &std::path::Path,
    model_name: &str,
) -> Result<(), String> {
    let url = download_url(model_name).ok_or_else(|| format!("Unknown model: {}", model_name))?;
    let client = reqwest::Client::new();
    let mut saved = false;
    let mut last_status = String::from("no attempts");

    // Candidate token URLs: repo root first (parismita layout), then lang dir (sulabh layout)
    let main_root = url
        .split("/resolve/main/")
        .next()
        .map(|root| format!("{}/resolve/main", root));
    let lang_dir = &url[..url.rfind('/').unwrap_or(url.len())];

    let mut candidates: Vec<(String, String)> = Vec::new();
    if let Some(root) = main_root {
        candidates.push(("tokens.txt".into(), format!("{}/tokens.txt", root)));
    }
    candidates.push(("tokens.txt".into(), format!("{}/tokens.txt", lang_dir)));
    candidates.push(("vocab.json".into(), format!("{}/vocab.json", lang_dir)));

    for (fname, furl) in candidates {
        if target_dir.join(&fname).exists() {
            return Ok(());
        }
        match client.get(&furl).send().await {
            Ok(resp) if resp.status().is_success() => {
                let bytes = resp
                    .bytes()
                    .await
                    .map_err(|e| format!("failed to read {}: {}", fname, e))?;
                let dest = target_dir.join(&fname);
                std::fs::write(&dest, &bytes)
                    .map_err(|e| format!("failed to write {}: {}", fname, e))?;
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    let _ = std::fs::set_permissions(&dest, std::fs::Permissions::from_mode(0o600));
                }
                saved = true;
                break;
            }
            Ok(resp) => {
                last_status = format!("{} -> HTTP {}", fname, resp.status());
            }
            Err(e) => {
                last_status = format!("{} -> {}", fname, e);
            }
        }
    }

    if saved {
        Ok(())
    } else {
        Err(format!("language data unavailable ({})", last_status))
    }
}

/// Repair path: install missing tokens/vocab for an already-downloaded Indic model.
#[tauri::command]
pub async fn install_model_assets(model_name: String) -> Result<(), String> {
    if !model_name.starts_with("indicconformer-") {
        return Err("Only IndicConformer models need language data".into());
    }
    let dir_name = onnx_dir_name(&model_name).ok_or("Unknown model")?;
    let target_dir = get_models_dir().join(&dir_name);
    if !target_dir.exists() {
        return Err(format!("Model '{}' is not downloaded", model_name));
    }
    fetch_indic_assets(&target_dir, &model_name).await
}

/// True when a downloaded Indic model is missing its language data.
#[tauri::command]
pub fn has_model_assets(model_name: String) -> bool {
    let Some(dir_name) = onnx_dir_name(&model_name) else {
        return false;
    };
    let dir = get_models_dir().join(&dir_name);
    dir.join("tokens.txt").exists() || dir.join("vocab.json").exists()
}
