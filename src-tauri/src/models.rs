use std::fs;
use std::path::PathBuf;

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
                        if name.ends_with(".bin") {
                            models.push(name.to_string());
                        }
                    }
                }
            }
        }
    }
    models
}

#[tauri::command]
pub fn download_model(model_name: String) -> Result<String, String> {
    let url = match model_name.as_str() {
        "tiny.en" => "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin",
        "base.en" => "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin",
        "small.en" => "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin",
        _ => return Err("Unknown model name".to_string()),
    };

    let target_path = get_models_dir().join(format!("ggml-{}.bin", model_name));
    if target_path.exists() {
        return Ok(target_path.to_string_lossy().to_string());
    }

    let response = reqwest::blocking::get(url).map_err(|e| e.to_string())?;
    let bytes = response.bytes().map_err(|e| e.to_string())?;

    fs::write(&target_path, bytes).map_err(|e| e.to_string())?;

    Ok(target_path.to_string_lossy().to_string())
}
