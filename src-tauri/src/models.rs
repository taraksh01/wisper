use futures_util::StreamExt;
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};

pub fn get_models_dir() -> PathBuf {
    let mut path = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
    path.push("v3");
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
            if let Ok(file_type) = entry.file_type() {
                if file_type.is_file() {
                    if let Some(name) = entry.file_name().to_str() {
                        if name.ends_with(".bin") || name.ends_with(".gguf") {
                            models.push(name.to_string());
                        }
                    }
                }
            }
        }
    }
    models
}

pub fn download_url(model_name: &str) -> Option<String> {
    let url = match model_name {
        "tiny.en" => "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin",
        "base.en" => "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin",
        "small.en" => "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin",
        "tiny" => "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin",
        "base" => "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
        "small" => "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin",
        "medium" => "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin",
        "large-v3" => "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin",
        "large-v3-turbo" => "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin",
        "parakeet-tdt_ctc-110m" => "https://huggingface.co/mudler/parakeet-cpp-gguf/resolve/main/parakeet-tdt_ctc-110m-f16.gguf",
        "parakeet-tdt-0.6b-v2" => "https://huggingface.co/mudler/parakeet-cpp-gguf/resolve/main/tdt-0.6b-v2-f16.gguf",
        "parakeet-tdt-0.6b-v3" => "https://huggingface.co/mudler/parakeet-cpp-gguf/resolve/main/tdt-0.6b-v3-f16.gguf",
        "parakeet-ctc-0.6b" => "https://huggingface.co/mudler/parakeet-cpp-gguf/resolve/main/parakeet-ctc-0.6b-f16.gguf",
        "parakeet-tdt-1.1b" => "https://huggingface.co/mudler/parakeet-cpp-gguf/resolve/main/parakeet-tdt-1.1b-f16.gguf",
        _ => return None,
    };
    Some(url.to_string())
}

fn is_gguf_model(model_name: &str) -> bool {
    model_name.starts_with("parakeet-")
}

#[tauri::command]
pub async fn download_model(app_handle: AppHandle, model_name: String) -> Result<String, String> {
    let url = download_url(&model_name).ok_or_else(|| {
        format!("Unknown model: {}.", model_name)
    })?;

    let filename = if is_gguf_model(&model_name) {
        format!("{}.gguf", model_name)
    } else {
        format!("ggml-{}.bin", model_name)
    };

    let target_path = get_models_dir().join(&filename);
    if target_path.exists() {
        return Ok(target_path.to_string_lossy().to_string());
    }

    let client = reqwest::Client::new();
    let response = client.get(&url).send().await.map_err(|e| e.to_string())?;

    let total = response.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;
    let mut file = fs::File::create(&target_path).map_err(|e| e.to_string())?;

    let mut stream = response.bytes_stream();
    let mut last_emitted = 0u32;

    while let Some(chunk_result) = stream.next().await {
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

    Ok(target_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn delete_model(model_name: String) -> Result<(), String> {
    let path = get_models_dir().join(&model_name);
    if !path.exists() {
        return Err(format!("Model '{}' not found", model_name));
    }
    fs::remove_file(&path).map_err(|e| format!("Failed to delete model: {}", e))
}

#[tauri::command]
pub fn get_models_dir_path() -> String {
    get_models_dir().to_string_lossy().to_string()
}
