use futures_util::StreamExt;
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::{AppHandle, Emitter};

// Per-model cancel flags - allows concurrent downloads without canceling others.
static ACTIVE_CANCEL: once_cell::sync::Lazy<
    Mutex<std::collections::HashMap<String, Arc<AtomicBool>>>,
> = once_cell::sync::Lazy::new(|| Mutex::new(std::collections::HashMap::new()));

static MODELS_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
fn models_client() -> &'static reqwest::Client {
    MODELS_CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(15))
            .read_timeout(std::time::Duration::from_secs(60))
            .build()
            .unwrap_or_else(|e| {
                eprintln!("[models] failed to build client: {} - using default", e);
                reqwest::Client::new()
            })
    })
}

pub fn get_models_dir() -> PathBuf {
    let mut path = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
    path.push(crate::app_info::data_dir_name());
    path.push("models");
    let _ = fs::create_dir_all(&path);
    path
}

pub fn is_model_complete(dir: &std::path::Path, name: &str) -> bool {
    // Existence alone passes 0-byte truncated downloads — require non-empty files.
    let ok = |p: std::path::PathBuf| {
        std::fs::metadata(&p).map(|m| m.len() > 0).unwrap_or(false)
    };
    let f = |n: &str| ok(dir.join(n));
    if name.starts_with("parakeet-") {
        let has_encoder = f("encoder-model.int8.onnx")
            || f("encoder-model.onnx")
            || f("model.onnx");
        let has_decoder = f("decoder_joint-model.int8.onnx")
            || f("decoder-model.int8.onnx")
            || f("model.onnx");
        return has_encoder
            && has_decoder
            && (f("vocab.txt") || f("tokens.txt") || f("vocab.json"));
    }
    if name.starts_with("indicconformer-600m-multi") {
        return f("encoder-model.onnx")
            && f("encoder-model.onnx.data")
            && f("ctc_decoder-model.onnx")
            && f("nemo128.onnx")
            && f("vocab.txt")
            && f("language_spans.json");
    }
    if name.starts_with("moonshine-tiny-en-int8") || name.starts_with("sherpa-onnx-moonshine-tiny-en") {
        return f("encode.int8.onnx")
            && f("cached_decode.int8.onnx")
            && f("uncached_decode.int8.onnx")
            && f("tokens.txt");
    }
    if name.starts_with("whisper-tiny") || name.starts_with("sherpa-onnx-whisper-tiny") {
        return f("tiny-encoder.onnx")
            && f("tiny-decoder.onnx")
            && f("tiny-tokens.txt");
    }
    if name.starts_with("whisper-base") || name.starts_with("sherpa-onnx-whisper-base") {
        return f("base-encoder.onnx")
            && f("base-decoder.onnx")
            && f("base-tokens.txt");
    }
    if name.starts_with("sensevoice") || name.starts_with("sherpa-onnx-sense-voice") {
        return f("model.int8.onnx") || f("model.onnx");
    }
    if name.starts_with("qwen3-asr") || name.starts_with("sherpa-onnx-qwen3-asr") {
        return f("conv_frontend.onnx")
            && (f("encoder.int8.onnx") || f("encoder.onnx"))
            && (f("decoder.int8.onnx") || f("decoder.onnx"))
            && ok(dir.join("tokenizer").join("vocab.json"));
    }
    if name.starts_with("whisper-large-v3") {
        return f("large-v3-encoder.int8.onnx")
            && f("large-v3-decoder.int8.onnx")
            && f("large-v3-tokens.txt");
    }
    if name.starts_with("indicconformer-120m-") || name == "indicconformer-8lang" {
        return (f("model.onnx") || f("model.int8.onnx"))
            && (f("tokens.txt") || f("vocab.json"));
    }
    if f("model.onnx") || f("encoder_model.onnx") {
        return true;
    }
    false
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
                        || name.starts_with("moonshine-")
                        || name.starts_with("sherpa-onnx-moonshine-")
                        || name.starts_with("whisper-large-v3")
                        || name.starts_with("whisper-tiny")
                        || name.starts_with("sherpa-onnx-whisper-tiny")
                        || name.starts_with("whisper-base")
                        || name.starts_with("sherpa-onnx-whisper-base")
                        || name.starts_with("sensevoice")
                        || name.starts_with("sherpa-onnx-sense-voice")
                        || name.starts_with("qwen3-asr")
                        || name.starts_with("sherpa-onnx-qwen3-asr"))
                {
                    let path = entry.path();
                    if is_model_complete(&path, &name) {
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
        "moonshine-tiny-en-int8" => "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-moonshine-tiny-en-int8.tar.bz2",
        "indicconformer-600m-multi" => "https://huggingface.co/christopherthompson81/indicconformer-600m-onnx/resolve/main/encoder-model.onnx",
        "whisper-large-v3-int8" => "https://huggingface.co/csukuangfj/sherpa-onnx-whisper-large-v3/resolve/main/large-v3-encoder.int8.onnx",
        "whisper-tiny-int8" => "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-tiny.tar.bz2",
        "whisper-base-int8" => "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-base.tar.bz2",
        "sensevoice-small-int8" => "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2",
        "qwen3-asr-0.6b-int8" => "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25.tar.bz2",
        _ => return None,
    };
    Some(url.to_string())
}

pub fn pretty_model_name(id: &str) -> String {
    match id {
        "parakeet-onnx-tdt-0.6b-v3" | "parakeet-tdt-0.6b-v3-int8" => "Parakeet TDT 0.6B V3".into(),
        "parakeet-onnx-tdt-0.6b-v2" | "parakeet-tdt-0.6b-v2-int8" => "Parakeet TDT 0.6B V2".into(),
        "indicconformer-120m-hi" => "IndicConformer Hindi 120M".into(),
        "indicconformer-120m-bn" => "IndicConformer Bengali 120M".into(),
        "indicconformer-120m-ta" => "IndicConformer Tamil 120M".into(),
        "indicconformer-120m-te" => "IndicConformer Telugu 120M".into(),
        "indicconformer-120m-mr" => "IndicConformer Marathi 120M".into(),
        "indicconformer-120m-gu" => "IndicConformer Gujarati 120M".into(),
        "indicconformer-120m-kn" => "IndicConformer Kannada 120M".into(),
        "indicconformer-120m-ml" => "IndicConformer Malayalam 120M".into(),
        "indicconformer-120m-pa" => "IndicConformer Punjabi 120M".into(),
        "indicconformer-8lang" => "IndicConformer 8-Lang Multi".into(),
        "indicconformer-600m-multi" => "IndicConformer 600M Multi".into(),
        "whisper-large-v3-int8" => "Whisper Large V3".into(),
        "moonshine-base" => "Moonshine Base".into(),
        "moonshine-tiny-en-int8" | "sherpa-onnx-moonshine-tiny-en-int8" => "Moonshine Tiny".into(),
        "whisper-tiny-int8" | "sherpa-onnx-whisper-tiny" => "Whisper Tiny".into(),
        "whisper-base-int8" | "sherpa-onnx-whisper-base" => "Whisper Base".into(),
        "sensevoice-small-int8" | "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17" => {
            "SenseVoice Small".into()
        }
        "qwen3-asr-0.6b-int8"
        | "sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25"
        | "sherpa-onnx-qwen3-asr-0.6b-int8-2026-03-25" => "Qwen3-ASR 0.6B".into(),
        _ => {
            let s = id
                .strip_prefix("sherpa-onnx-")
                .unwrap_or(id)
                .replace('-', " ")
                .replace('_', " ");
            let mut out = String::with_capacity(s.len());
            let mut cap = true;
            for ch in s.chars() {
                if cap && ch.is_ascii_alphabetic() {
                    out.push(ch.to_ascii_uppercase());
                    cap = false;
                } else {
                    out.push(ch);
                }
                if ch == ' ' {
                    cap = true;
                }
            }
            out.replace("Int8", "INT8")
                .replace("  ", " ")
                .trim()
                .to_string()
        }
    }
}

pub fn onnx_dir_name(model_name: &str) -> Option<String> {
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
        "moonshine-tiny-en-int8" => Some("sherpa-onnx-moonshine-tiny-en-int8".into()),
        "indicconformer-600m-multi" => Some("indicconformer-600m-multi".into()),
        "whisper-large-v3-int8" => Some("whisper-large-v3-int8".into()),
        "whisper-tiny-int8" => Some("sherpa-onnx-whisper-tiny".into()),
        "whisper-base-int8" => Some("sherpa-onnx-whisper-base".into()),
        "sensevoice-small-int8" => Some("sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17".into()),
        "qwen3-asr-0.6b-int8" => Some("sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25".into()),
        _ => None,
    }
}

/// Multi-file model bundles. Returns `(remote_subpath, local_filename, expected_size_bytes)` per file.
/// Sizes are advisory; HTTP `Content-Length` is the source of truth.
fn multi_file_download(model_name: &str) -> Option<Vec<(String, String, u64)>> {
    match model_name {
        "indicconformer-600m-multi" => Some(vec![
            ("encoder-model.onnx".into(), "encoder-model.onnx".into(), 42_006_402),
            ("encoder-model.onnx.data".into(), "encoder-model.onnx.data".into(), 2_430_799_872),
            ("ctc_decoder-model.onnx".into(), "ctc_decoder-model.onnx".into(), 23_095_900),
            ("nemo128.onnx".into(), "nemo128.onnx".into(), 1_151_666),
            ("vocab.txt".into(), "vocab.txt".into(), 41_814),
            ("language_spans.json".into(), "language_spans.json".into(), 1_397),
            ("config.json".into(), "config.json".into(), 467),
        ]),
        "whisper-large-v3-int8" => Some(vec![
            (
                "large-v3-encoder.int8.onnx".into(),
                "large-v3-encoder.int8.onnx".into(),
                766_671_985,
            ),
            (
                "large-v3-decoder.int8.onnx".into(),
                "large-v3-decoder.int8.onnx".into(),
                1_008_265_203,
            ),
            (
                "large-v3-tokens.txt".into(),
                "large-v3-tokens.txt".into(),
                818_000,
            ),
        ]),
        _ => None,
    }
}

struct ClearGuard {
    key: String,
    active: bool,
}
impl Drop for ClearGuard {
    fn drop(&mut self) {
        if self.active {
            ACTIVE_CANCEL
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .remove(&self.key);
        }
    }
}

#[tauri::command]
pub async fn download_model(app_handle: AppHandle, model_name: String) -> Result<String, String> {
    let cancel = {
        let mut map = ACTIVE_CANCEL
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        if map.contains_key(&model_name) {
            return Err(format!("Already downloading {}", model_name));
        }
        let flag = Arc::new(AtomicBool::new(false));
        map.insert(model_name.clone(), flag.clone());
        flag
    };
    let mut _clear_guard = ClearGuard {
        key: model_name.clone(),
        active: true,
    };

    let url = download_url(&model_name).ok_or_else(|| format!("Unknown model: {}.", model_name))?;

    let models_dir = get_models_dir();

    let dir_name = onnx_dir_name(&model_name).ok_or("Missing directory name for ONNX model")?;
    let target_dir = models_dir.join(&dir_name);
    if target_dir.exists() {
        if is_model_complete(&target_dir, &dir_name) {
            ACTIVE_CANCEL
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .remove(&model_name);
            _clear_guard.active = false;
            return Ok(target_dir.to_string_lossy().to_string());
        }
        let _ = fs::remove_dir_all(&target_dir);
    }

    // Multi-file models: 600M Multi (7 files) and Whisper large-v3 int8 (3 files).
    if let Some(files) = multi_file_download(&model_name) {
        let _ = fs::create_dir_all(&target_dir);
        let total: u64 = files.iter().map(|(_, _, size)| *size).sum();
        let mut downloaded: u64 = 0;
        let start = std::time::Instant::now();
        let client = models_client();
        for (sub_path, dest_name, file_size) in files {
            if cancel.load(Ordering::Relaxed) {
                let _ = fs::remove_dir_all(&target_dir);
                ACTIVE_CANCEL
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .remove(&model_name);
                _clear_guard.active = false;
                let _ = app_handle.emit(
                    "download-canceled",
                    serde_json::json!({ "model": &model_name }),
                );
                return Err("Download canceled".into());
            }
            let file_url = format!(
                "{}/resolve/main/{}",
                url.split("/resolve/main/").next().unwrap_or(&url),
                sub_path
            );
            let response = client
                .get(&file_url)
                .send()
                .await
                .map_err(|e| format!("Failed to fetch {}: {}", sub_path, e))?;
            if !response.status().is_success() {
                let _ = fs::remove_dir_all(&target_dir);
                return Err(format!(
                    "Failed to fetch {}: HTTP {}",
                    sub_path,
                    response.status()
                ));
            }
            let dest = target_dir.join(&dest_name);
            #[cfg(unix)]
            let mut f = {
                use std::os::unix::fs::OpenOptionsExt;
                std::fs::OpenOptions::new()
                    .create(true)
                    .write(true)
                    .truncate(true)
                    .mode(0o600)
                    .open(&dest)
                    .map_err(|e| format!("Failed to open {}: {}", dest_name, e))?
            };
            #[cfg(not(unix))]
            let mut f = fs::File::create(&dest)
                .map_err(|e| format!("Failed to open {}: {}", dest_name, e))?;
            let mut stream = response.bytes_stream();
            let mut last_emitted = 0u32;
            while let Some(chunk_result) = stream.next().await {
                if cancel.load(Ordering::Relaxed) {
                    let _ = fs::remove_dir_all(&target_dir);
                    ACTIVE_CANCEL
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .remove(&model_name);
                    _clear_guard.active = false;
                    let _ = app_handle.emit(
                        "download-canceled",
                        serde_json::json!({ "model": &model_name }),
                    );
                    return Err("Download canceled".into());
                }
                let chunk = chunk_result.map_err(|e| e.to_string())?;
                f.write_all(&chunk).map_err(|e| e.to_string())?;
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
                                "current_file": dest_name,
                                "expected_size": file_size,
                            }),
                        );
                    }
                }
            }
            f.sync_all().ok();
        }
        let _ = app_handle.emit(
            "download-progress",
            serde_json::json!({
                "model": &model_name,
                "progress": 100,
                "phase": "finalizing",
                "downloaded": downloaded,
                "total": total,
            }),
        );
        _clear_guard.active = false;
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
    } else if url.ends_with(".tar.bz2") {
        "tar.bz2"
    } else {
        "bin"
    };
    let mut temp_archive = std::env::temp_dir().join(format!(
        "wisper_{}_{}_{}.{}",
        &model_name,
        nanos,
        std::process::id(),
        ext
    ));

    let client = models_client();
    let response = client.get(&url).send().await.map_err(|e| e.to_string())?;
    let total = response.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;
    #[allow(unused_mut)]
    let mut file: fs::File = {
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            // create_new (O_EXCL): never truncate an existing file — a planted
            // symlink/name at our path must fail, not get overwritten.
            loop {
                match std::fs::OpenOptions::new()
                    .create_new(true)
                    .write(true)
                    .mode(0o600)
                    .open(&temp_archive)
                {
                    Ok(f) => break f,
                    Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                        let n = std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_nanos();
                        temp_archive = std::env::temp_dir().join(format!(
                            "wisper_{}_{}_{}.{}",
                            &model_name,
                            n,
                            std::process::id(),
                            ext
                        ));
                        continue;
                    }
                    Err(e) => return Err(e.to_string()),
                }
            }
        }
        #[cfg(not(unix))]
        {
            loop {
                match std::fs::OpenOptions::new()
                    .create_new(true)
                    .write(true)
                    .open(&temp_archive)
                {
                    Ok(f) => break f,
                    Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                        let n = std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_nanos();
                        temp_archive = std::env::temp_dir().join(format!(
                            "wisper_{}_{}_{}.{}",
                            &model_name,
                            n,
                            std::process::id(),
                            ext
                        ));
                        continue;
                    }
                    Err(e) => return Err(e.to_string()),
                }
            }
        }
    };

    let mut stream = response.bytes_stream();
    let mut last_emitted = 0u32;
    let mut last_unknown_emit = std::time::Instant::now();
    let start = std::time::Instant::now();

    while let Some(chunk_result) = stream.next().await {
        if cancel.load(Ordering::Relaxed) {
            let _ = fs::remove_file(&temp_archive);
            ACTIVE_CANCEL
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .remove(&model_name);
            _clear_guard.active = false;
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
        } else if downloaded % (512 * 1024) < 8192
            && last_unknown_emit.elapsed().as_millis() > 200
        {
            last_unknown_emit = std::time::Instant::now();
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

    // Post-download phase — keep the UI from looking stuck at 100%.
    if ext == "onnx" {
        if model_name.starts_with("indicconformer-") {
            let _ = app_handle.emit(
                "download-progress",
                serde_json::json!({
                    "model": &model_name,
                    "progress": 100,
                    "phase": "installing",
                    "downloaded": downloaded,
                    "total": total,
                }),
            );
        } else {
            let _ = app_handle.emit(
                "download-progress",
                serde_json::json!({
                    "model": &model_name,
                    "progress": 100,
                    "phase": "finalizing",
                    "downloaded": downloaded,
                    "total": total,
                }),
            );
        }
        let _ = fs::create_dir_all(&target_dir);
        let dest = target_dir.join("model.onnx");
        fs::copy(&temp_archive, &dest).map_err(|e| format!("Failed to save model: {}", e))?;
        let _ = fs::remove_file(&temp_archive);
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
        let _ = app_handle.emit(
            "download-progress",
            serde_json::json!({
                "model": &model_name,
                "progress": 100,
                "phase": "verifying",
                "downloaded": downloaded,
                "total": total,
            }),
        );
        // Extract archive with path traversal validation (supports .tar.gz and .tar.bz2)
        // Single-pass validate+unpack to avoid TOCTOU (no second open that could
        // observe a swapped file after the validation scan).
        let is_bz2 = ext == "tar.bz2";
        let mut validated_paths: Vec<PathBuf> = Vec::new();
        let _ = app_handle.emit(
            "download-progress",
            serde_json::json!({
                "model": &model_name,
                "progress": 100,
                "phase": "extracting",
                "downloaded": downloaded,
                "total": total,
            }),
        );
        let validate_dest = |path: &std::path::Path, models_dir: &PathBuf| -> Result<PathBuf, String> {
            if path.is_absolute()
                || path
                    .components()
                    .any(|c| matches!(c, std::path::Component::ParentDir))
            {
                return Err("Archive contains invalid path".into());
            }
            let dest = models_dir.join(path);
            if !dest.starts_with(models_dir) {
                return Err("Archive path escapes models dir".into());
            }
            Ok(dest)
        };
        if is_bz2 {
            let archive_file = fs::File::open(&temp_archive).map_err(|e| e.to_string())?;
            let mut archive = tar::Archive::new(bzip2::read::BzDecoder::new(archive_file));
            for entry in archive
                .entries()
                .map_err(|e| format!("Failed to read archive: {}", e))?
            {
                let mut entry = entry.map_err(|e| format!("Bad archive entry: {}", e))?;
                if matches!(entry.link_name(), Ok(Some(_))) {
                    return Err("Archive contains symlink".into());
                }
                let et = entry.header().entry_type();
                if et == tar::EntryType::Block
                    || et == tar::EntryType::Char
                    || et == tar::EntryType::Fifo
                {
                    return Err(format!("Archive contains special file: {:?}", et));
                }
                if !(et.is_file() || et.is_dir()) {
                    if et != tar::EntryType::GNULongName
                        && et != tar::EntryType::GNULongLink
                        && et != tar::EntryType::XHeader
                        && et != tar::EntryType::XGlobalHeader
                    {
                        return Err(format!("Archive contains unsupported entry type: {:?}", et));
                    }
                    continue;
                }
                let path = entry.path().map_err(|e| format!("Bad entry path: {}", e))?.into_owned();
                let dest = validate_dest(&path, &models_dir)?;
                validated_paths.push(dest.clone());
                entry
                    .unpack_in(&models_dir)
                    .map_err(|e| format!("Failed to extract model: {}", e))?;
            }
        } else {
            let archive_file = fs::File::open(&temp_archive).map_err(|e| e.to_string())?;
            let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(archive_file));
            for entry in archive
                .entries()
                .map_err(|e| format!("Failed to read archive: {}", e))?
            {
                let mut entry = entry.map_err(|e| format!("Bad archive entry: {}", e))?;
                if matches!(entry.link_name(), Ok(Some(_))) {
                    return Err("Archive contains symlink".into());
                }
                let et = entry.header().entry_type();
                if et == tar::EntryType::Block
                    || et == tar::EntryType::Char
                    || et == tar::EntryType::Fifo
                {
                    return Err(format!("Archive contains special file: {:?}", et));
                }
                if !(et.is_file() || et.is_dir()) {
                    if et != tar::EntryType::GNULongName
                        && et != tar::EntryType::GNULongLink
                        && et != tar::EntryType::XHeader
                        && et != tar::EntryType::XGlobalHeader
                    {
                        return Err(format!("Archive contains unsupported entry type: {:?}", et));
                    }
                    continue;
                }
                let path = entry.path().map_err(|e| format!("Bad entry path: {}", e))?.into_owned();
                let dest = validate_dest(&path, &models_dir)?;
                validated_paths.push(dest.clone());
                entry
                    .unpack_in(&models_dir)
                    .map_err(|e| format!("Failed to extract model: {}", e))?;
            }
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            for dest in validated_paths {
                if dest.exists() {
                    if dest.is_dir() {
                        let _ = std::fs::set_permissions(&dest, std::fs::Permissions::from_mode(0o700));
                    } else if dest.is_file() {
                        let _ = std::fs::set_permissions(&dest, std::fs::Permissions::from_mode(0o600));
                    }
                }
            }
        }
        if !models_dir
            .canonicalize()
            .unwrap_or_else(|_| models_dir.clone())
            .exists()
        {
            return Err("Models dir missing after unpack".into());
        }
        let _ = fs::remove_file(&temp_archive);
    }

    _clear_guard.active = false;
    ACTIVE_CANCEL
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(&model_name);
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
        || model_name.starts_with("moonshine-")
        || model_name.starts_with("whisper-")
        || model_name.starts_with("sensevoice-")
        || model_name.starts_with("qwen3-asr"))
    {
        return Err("Invalid model name prefix".to_string());
    }
    let models_dir = get_models_dir();
    let canonical_base = models_dir.canonicalize().unwrap_or(models_dir.clone());
    let dir_name = onnx_dir_name(&model_name).unwrap_or(model_name.clone());
    let path = models_dir.join(&dir_name);
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
    let client = models_client();
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
    if !(model_name.starts_with("indicconformer-") || model_name.starts_with("whisper-large-v3")) {
        return Err("Only IndicConformer / Whisper models need language data".into());
    }
    let dir_name = onnx_dir_name(&model_name).ok_or("Unknown model")?;
    let target_dir = get_models_dir().join(&dir_name);
    if !target_dir.exists() {
        return Err(format!("Model '{}' is not downloaded", model_name));
    }
    if model_name == "indicconformer-600m-multi" || model_name.starts_with("whisper-large-v3") {
        return Ok(());
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
    if model_name == "indicconformer-600m-multi" {
        return dir.join("vocab.txt").exists() && dir.join("language_spans.json").exists();
    }
    if model_name.starts_with("whisper-large-v3") {
        return dir.join("large-v3-tokens.txt").exists();
    }
    dir.join("tokens.txt").exists() || dir.join("vocab.json").exists()
}
