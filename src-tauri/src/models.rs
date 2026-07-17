use futures_util::StreamExt;
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

// Cancel flag for the currently active download (at most one at a time).
static ACTIVE_CANCEL: Mutex<Option<Arc<AtomicBool>>> = Mutex::new(None);

pub fn get_models_dir() -> PathBuf {
    let mut path = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
    path.push("wisper");
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
                if file_type.is_dir() && name.starts_with("parakeet-") {
                    models.push(name);
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
        _ => return None,
    };
    Some(url.to_string())
}

fn onnx_dir_name(model_name: &str) -> Option<String> {
    match model_name {
        "parakeet-onnx-tdt-0.6b-v3" => Some("parakeet-tdt-0.6b-v3-int8".into()),
        "parakeet-onnx-tdt-0.6b-v2" => Some("parakeet-tdt-0.6b-v2-int8".into()),
        _ => None,
    }
}

#[tauri::command]
pub async fn download_model(app_handle: AppHandle, model_name: String) -> Result<String, String> {
    let cancel = Arc::new(AtomicBool::new(false));
    *ACTIVE_CANCEL.lock().unwrap() = Some(cancel.clone());

    let url = download_url(&model_name).ok_or_else(|| {
        format!("Unknown model: {}.", model_name)
    })?;

    let models_dir = get_models_dir();

    let dir_name = onnx_dir_name(&model_name).ok_or("Missing directory name for ONNX model")?;
    let target_dir = models_dir.join(&dir_name);
    if target_dir.exists() {
        *ACTIVE_CANCEL.lock().unwrap() = None;
        return Ok(target_dir.to_string_lossy().to_string());
    }

    let temp_archive = std::env::temp_dir().join(format!("wisper_{}.tar.gz", &model_name));

    let client = reqwest::Client::new();
    let response = client.get(&url).send().await.map_err(|e| e.to_string())?;
    let total = response.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;
    let mut file = fs::File::create(&temp_archive).map_err(|e| e.to_string())?;

    let mut stream = response.bytes_stream();
    let mut last_emitted = 0u32;

    while let Some(chunk_result) = stream.next().await {
        if cancel.load(Ordering::Relaxed) {
            let _ = fs::remove_file(&temp_archive);
            *ACTIVE_CANCEL.lock().unwrap() = None;
            let _ = app_handle.emit("download-canceled", serde_json::json!({ "model": &model_name }));
            return Err("Download canceled".into());
        }
        let chunk = chunk_result.map_err(|e| e.to_string())?;
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;

        if total > 0 {
            let pct = (downloaded as f64 / total as f64 * 100.0) as u32;
            if pct >= last_emitted + 1 || pct == 100 {
                last_emitted = pct;
                let _ = app_handle.emit("download-progress", serde_json::json!({
                    "model": &model_name,
                    "progress": pct,
                }));
            }
        }
    }

    // Extract archive
    let archive_file = fs::File::open(&temp_archive).map_err(|e| e.to_string())?;
    let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(archive_file));
    archive.unpack(&models_dir).map_err(|e| format!("Failed to extract model: {}", e))?;

    let _ = fs::remove_file(&temp_archive);

    *ACTIVE_CANCEL.lock().unwrap() = None;

    Ok(target_dir.to_string_lossy().to_string())
}

#[tauri::command]
pub fn cancel_download() {
    if let Some(flag) = ACTIVE_CANCEL.lock().unwrap().as_ref() {
        flag.store(true, Ordering::Relaxed);
    }
}

#[tauri::command]
pub fn delete_model(model_name: String) -> Result<(), String> {
    let path = get_models_dir().join(&model_name);
    if !path.exists() {
        return Err(format!("Model '{}' not found", model_name));
    }
    if path.is_dir() {
        fs::remove_dir_all(&path).map_err(|e| format!("Failed to delete model: {}", e))
    } else {
        fs::remove_file(&path).map_err(|e| format!("Failed to delete model: {}", e))
    }
}