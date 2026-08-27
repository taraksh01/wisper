use rusqlite::{params, Connection, Result as SqlResult};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

const DB_BUSY_TIMEOUT: Duration = Duration::from_millis(5000);
static RECORDING_DIR_CACHE: OnceLock<PathBuf> = OnceLock::new();

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryEntry {
    pub id: i64,
    pub raw_text: String,
    pub formatted_text: Option<String>,
    pub agent_name: Option<String>,
    pub duration_ms: i64,
    pub word_count: i64,
    pub created_at: String,
    pub recording_path: Option<String>,
}

static HISTORY_CONN: once_cell::sync::Lazy<Mutex<Connection>> = once_cell::sync::Lazy::new(|| {
    let db_path = HistoryManager::get_db_path();
    let conn = Connection::open(&db_path).unwrap_or_else(|e| {
        eprintln!(
            "[history] failed to open {}: {e} — using in-memory DB",
            db_path.display()
        );
        Connection::open_in_memory().unwrap_or_else(|e2| {
            eprintln!("[history] in-memory fallback also failed: {e2}");
            panic!("Failed to open history DB");
        })
    });
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&db_path, std::fs::Permissions::from_mode(0o600));
    }
    let _ = conn.busy_timeout(DB_BUSY_TIMEOUT);
    let _ = conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;");
    if let Err(e) = conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                raw_text TEXT NOT NULL,
                formatted_text TEXT,
                agent_name TEXT,
                duration_ms INTEGER DEFAULT 0,
                word_count INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now')),
                recording_path TEXT
            );",
    ) {
        eprintln!("[history] failed to create table: {e}");
    }
    let _ = conn.execute("ALTER TABLE history ADD COLUMN recording_path TEXT", []);
    Mutex::new(conn)
});

pub struct HistoryManager;

impl HistoryManager {
    pub fn new() -> Self {
        // Ensure DB is initialized (lazy)
        let _ = &*HISTORY_CONN;
        Self
    }

    fn conn() -> std::sync::MutexGuard<'static, Connection> {
        HISTORY_CONN.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn get_db_path() -> PathBuf {
        let mut path = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
        path.push(crate::app_info::data_dir_name());
        let _ = std::fs::create_dir_all(&path);
        path.push("history.db");
        path
    }

    pub fn insert(
        &self,
        raw_text: &str,
        formatted_text: Option<&str>,
        agent_name: Option<&str>,
        duration_ms: i64,
        recording_path: Option<&str>,
    ) -> SqlResult<()> {
        let word_count = raw_text.split_whitespace().count() as i64;
        // Skip zero-word entries — they pollute history and have no value.
        // The caller (coordinator) already avoids saving the recording file in this case,
        // but we defend here as well for any direct callers.
        if word_count == 0
            && formatted_text
                .map(|s| s.split_whitespace().count() == 0)
                .unwrap_or(true)
        {
            eprintln!("[history] skipping zero-word entry");
            return Ok(());
        }
        let conn = Self::conn();
        conn.execute(
            "INSERT INTO history (raw_text, formatted_text, agent_name, duration_ms, word_count, recording_path)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![raw_text, formatted_text, agent_name, duration_ms, word_count, recording_path],
        )?;
        Ok(())
    }

    pub fn update(&self, id: i64, raw_text: &str, formatted_text: Option<&str>) -> SqlResult<()> {
        let conn = Self::conn();
        conn.execute(
            "UPDATE history SET raw_text = ?1, formatted_text = ?2 WHERE id = ?3",
            params![raw_text, formatted_text, id],
        )?;
        Ok(())
    }

    pub fn delete(&self, id: i64) -> SqlResult<()> {
        let conn = Self::conn();
        conn.execute("DELETE FROM history WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn get_history(&self, limit: i64, offset: i64) -> SqlResult<Vec<HistoryEntry>> {
        let conn = Self::conn();
        let mut stmt = conn.prepare(
            "SELECT id, raw_text, formatted_text, agent_name, duration_ms, word_count, created_at, recording_path
             FROM history ORDER BY id DESC LIMIT ?1 OFFSET ?2",
        )?;

        let entries = stmt
            .query_map(params![limit, offset], |row| {
                Ok(HistoryEntry {
                    id: row.get(0)?,
                    raw_text: row.get(1)?,
                    formatted_text: row.get(2)?,
                    agent_name: row.get(3)?,
                    duration_ms: row.get(4)?,
                    word_count: row.get(5)?,
                    created_at: row.get(6)?,
                    recording_path: row.get(7)?,
                })
            })?
            .collect::<SqlResult<Vec<_>>>()?;

        Ok(entries)
    }

    pub fn get_stats(&self) -> SqlResult<(i64, i64, f64)> {
        let conn = Self::conn();
        let total: i64 = conn.query_row("SELECT COUNT(*) FROM history", [], |row| row.get(0))?;
        let total_words: i64 = conn.query_row(
            "SELECT COALESCE(SUM(word_count), 0) FROM history",
            [],
            |row| row.get(0),
        )?;
        let avg_words: f64 = if total > 0 {
            total_words as f64 / total as f64
        } else {
            0.0
        };
        Ok((total, total_words, avg_words))
    }

    pub fn clear_all(&self) -> SqlResult<()> {
        let conn = Self::conn();
        conn.execute("DELETE FROM history", [])?;
        Ok(())
    }

    /// Trim oldest entries when total exceeds `max_entries`.
    /// `mode` is "both" (delete rows + recordings) or "recordings_only" (keep rows, delete files).
    /// Returns number of entries affected.
    pub fn trim_history(&self, max_entries: i64, mode: &str) -> SqlResult<usize> {
        if max_entries <= 0 {
            return Ok(0);
        }
        let total: i64 = {
            let conn = Self::conn();
            conn.query_row("SELECT COUNT(*) FROM history", [], |r| r.get(0))?
        };
        if total <= max_entries {
            return Ok(0);
        }
        let excess = total - max_entries;
        // Collect oldest entries' paths without holding lock across I/O
        let oldest: Vec<(i64, Option<String>)> = {
            let conn = Self::conn();
            let mut stmt =
                conn.prepare("SELECT id, recording_path FROM history ORDER BY id ASC LIMIT ?1")?;
            let rows = stmt
                .query_map(params![excess], |r| Ok((r.get(0)?, r.get(1)?)))?
                .collect::<SqlResult<Vec<_>>>()?;
            rows
        };

        if mode == "recordings_only" {
            for (_, path) in &oldest {
                if let Some(ref p) = path {
                    if !p.is_empty() {
                        if let Ok(canonical) = validate_recording_path(p) {
                            let _ = std::fs::remove_file(canonical);
                        }
                    }
                }
            }
            let conn = Self::conn();
            conn.execute_batch("BEGIN IMMEDIATE")?;
            let mut cleared = 0;
            let mut ok = true;
            for (id, path) in oldest {
                if let Some(ref p) = path {
                    if !p.is_empty() {
                        match conn.execute(
                            "UPDATE history SET recording_path = NULL WHERE id = ?1",
                            params![id],
                        ) {
                            Ok(_) => cleared += 1,
                            Err(e) => {
                                eprintln!(
                                    "[history] failed to clear recording_path for id {}: {}",
                                    id, e
                                );
                                ok = false;
                                break;
                            }
                        }
                    }
                }
            }
            if ok {
                conn.execute_batch("COMMIT")?;
                Ok(cleared)
            } else {
                let _ = conn.execute_batch("ROLLBACK");
                Err(rusqlite::Error::ExecuteReturnedResults)
            }
        } else {
            for (_, path) in &oldest {
                if let Some(ref p) = path {
                    if let Ok(canonical) = validate_recording_path(p) {
                        let _ = std::fs::remove_file(canonical);
                    }
                }
            }
            let conn = Self::conn();
            conn.execute_batch("BEGIN IMMEDIATE")?;
            let res = conn.execute(
                "DELETE FROM history WHERE id IN (SELECT id FROM history ORDER BY id ASC LIMIT ?1)",
                params![excess],
            );
            match res {
                Ok(n) => {
                    conn.execute_batch("COMMIT")?;
                    Ok(n)
                }
                Err(e) => {
                    let _ = conn.execute_batch("ROLLBACK");
                    Err(e)
                }
            }
        }
    }

    /// Delete all history entries with zero words (polluted empty transcriptions).
    /// Returns number of deleted rows. Also removes associated recording files.
    pub fn delete_zero_word_entries(&self) -> SqlResult<usize> {
        let paths: Vec<Option<String>> = {
            let conn = Self::conn();
            let mut stmt = conn.prepare(
                "SELECT recording_path FROM history WHERE word_count = 0 OR trim(raw_text) = ''",
            )?;
            let rows = stmt
                .query_map([], |r| r.get(0))?
                .collect::<SqlResult<Vec<_>>>()?;
            rows
        };
        for p in &paths {
            if let Some(ref path) = p {
                if !path.is_empty() {
                    if let Ok(canonical) = validate_recording_path(path) {
                        let _ = std::fs::remove_file(canonical);
                    }
                }
            }
        }
        let conn = Self::conn();
        let n = conn.execute(
            "DELETE FROM history WHERE word_count = 0 OR trim(raw_text) = ''",
            [],
        )?;
        if n > 0 {
            eprintln!("[history] cleaned up {} zero-word entries", n);
        }
        Ok(n)
    }

    pub fn get_recording_dir() -> PathBuf {
        RECORDING_DIR_CACHE
            .get_or_init(|| {
                let mut path = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
                path.push(crate::app_info::data_dir_name());
                path.push("recordings");
                let _ = std::fs::create_dir_all(&path);
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700));
                }
                path
            })
            .clone()
    }
}

fn validate_recording_path(path: &str) -> Result<std::path::PathBuf, String> {
    let p = std::path::PathBuf::from(path);
    let dir = HistoryManager::get_recording_dir();
    let dir_canonical = dir.canonicalize().unwrap_or_else(|_| dir.clone());
    if p.exists() {
        let canonical = p
            .canonicalize()
            .map_err(|_| "Invalid recording path".to_string())?;
        if !canonical.starts_with(&dir_canonical) {
            return Err("Recording path outside allowed directory".into());
        }
        Ok(canonical)
    } else {
        // File already deleted — still verify it was inside the recordings dir
        let p_abs = if p.is_absolute() {
            p.clone()
        } else {
            dir.join(&p)
        };
        let parent = p_abs.parent().unwrap_or(&p_abs);
        let parent_canonical = parent
            .canonicalize()
            .unwrap_or_else(|_| parent.to_path_buf());
        if parent_canonical.starts_with(&dir_canonical) || p_abs.starts_with(&dir) {
            Ok(p)
        } else {
            Err("Recording path outside allowed directory".into())
        }
    }
}

fn rand_suffix() -> u16 {
    static CTR: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
    let c = CTR.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let pid = std::process::id() as u32;
    ((c ^ pid) & 0xFFFF) as u16
}

pub fn save_recording_to_disk(samples: &[f32], sample_rate: u32) -> Option<String> {
    let dir = HistoryManager::get_recording_dir();
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    // Add process id + random suffix to avoid same-millisecond collisions
    let suffix = format!("{:04x}", rand_suffix());
    let filename = format!("wisper_{}_{}.wav", ts, suffix);
    let path = dir.join(&filename);

    match wav_from_samples(samples, sample_rate, &path) {
        Ok(_) => Some(path.to_string_lossy().to_string()),
        Err(e) => {
            eprintln!("Failed to save recording: {}", e);
            None
        }
    }
}

fn wav_from_samples(
    samples: &[f32],
    sample_rate: u32,
    path: &std::path::Path,
) -> Result<(), String> {
    use std::io::Write;

    let mut raw = Vec::with_capacity(samples.len() * 2);
    for &s in samples {
        let clamped = s.clamp(-1.0, 1.0);
        let sample = (clamped * i16::MAX as f32) as i16;
        raw.extend_from_slice(&sample.to_le_bytes());
    }

    let data_size = raw.len() as u32;
    let file_size = 36 + data_size;

    #[allow(unused_mut)]
    let mut f: std::fs::File = {
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            std::fs::OpenOptions::new()
                .create(true)
                .write(true)
                .truncate(true)
                .mode(0o600)
                .open(path)
                .map_err(|e| e.to_string())?
        }
        #[cfg(not(unix))]
        {
            std::fs::File::create(path).map_err(|e| e.to_string())?
        }
    };
    f.write_all(b"RIFF").map_err(|e| e.to_string())?;
    f.write_all(&file_size.to_le_bytes())
        .map_err(|e| e.to_string())?;
    f.write_all(b"WAVE").map_err(|e| e.to_string())?;
    f.write_all(b"fmt ").map_err(|e| e.to_string())?;
    f.write_all(&16u32.to_le_bytes())
        .map_err(|e| e.to_string())?; // chunk size
    f.write_all(&1u16.to_le_bytes())
        .map_err(|e| e.to_string())?; // PCM
    f.write_all(&1u16.to_le_bytes())
        .map_err(|e| e.to_string())?; // mono
    f.write_all(&sample_rate.to_le_bytes())
        .map_err(|e| e.to_string())?;
    f.write_all(&(sample_rate * 2u32).to_le_bytes())
        .map_err(|e| e.to_string())?; // byte rate
    f.write_all(&2u16.to_le_bytes())
        .map_err(|e| e.to_string())?; // block align
    f.write_all(&16u16.to_le_bytes())
        .map_err(|e| e.to_string())?; // bits per sample
    f.write_all(b"data").map_err(|e| e.to_string())?;
    f.write_all(&data_size.to_le_bytes())
        .map_err(|e| e.to_string())?;
    f.write_all(&raw).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn get_history_entries(limit: i64, offset: i64) -> Result<Vec<HistoryEntry>, String> {
    let manager = HistoryManager::new();
    manager
        .get_history(limit, offset)
        .map_err(|e| format!("Failed to get history: {}", e))
}

#[tauri::command]
pub fn get_history_count() -> Result<i64, String> {
    let manager = HistoryManager::new();
    manager
        .get_stats()
        .map(|s| s.0)
        .map_err(|e| format!("Failed to count history: {}", e))
}

#[tauri::command]
pub fn get_history_stats() -> Result<(i64, i64, f64), String> {
    let manager = HistoryManager::new();
    manager
        .get_stats()
        .map_err(|e| format!("Failed to get stats: {}", e))
}

#[tauri::command]
pub fn delete_history_entry(id: i64) -> Result<(), String> {
    let manager = HistoryManager::new();
    manager
        .delete(id)
        .map_err(|e| format!("Failed to delete history entry: {}", e))
}

#[tauri::command]
pub fn update_history_entry(
    id: i64,
    raw_text: String,
    formatted_text: Option<String>,
) -> Result<(), String> {
    let manager = HistoryManager::new();
    manager
        .update(id, &raw_text, formatted_text.as_deref())
        .map_err(|e| format!("Failed to update history entry: {}", e))
}

#[tauri::command]
pub fn retranscribe_recording(recording_path: String) -> Result<String, String> {
    let validated = validate_recording_path(&recording_path)?;
    let (samples, sample_rate) =
        crate::audio::load_wav(validated.to_str().unwrap_or(&recording_path))?;

    // Load the current model from settings
    let settings = crate::settings::AppSettings::load();
    let model_dir = crate::models::get_models_dir();
    let model_path = model_dir.join(&settings.local_model_file);

    if !model_path.exists() {
        return Err(format!("Model file not found: {:?}", model_path));
    }

    let provider = crate::engine::create_local_engine(model_path);

    // Respect the same audio pipeline as live transcription: resample to 16kHz, optional
    // noise suppression, then VAD trimming with the user's threshold (1600 = 100ms @16kHz).
    let resampled = if sample_rate != 16000 {
        crate::engine::resample(&samples, sample_rate, 16000)
    } else {
        samples.clone()
    };
    let denoised = if settings.noise_suppression_enabled {
        crate::audio::suppress_noise(&resampled, 16000, settings.noise_suppression_level)
    } else {
        resampled
    };
    let trimmed = if settings.vad_enabled {
        crate::audio::trim_silence(&denoised, 1600, settings.vad_threshold)
    } else {
        denoised
    };
    if trimmed.is_empty() {
        return Err("No speech detected in recording".to_string());
    }

    provider.transcribe(&trimmed, 16000)
}

#[tauri::command]
pub fn clear_history() -> Result<(), String> {
    let manager = HistoryManager::new();

    // Collect all recording paths before deleting
    let entries = manager
        .get_history(i64::MAX, 0)
        .map_err(|e| format!("Failed to get history: {}", e))?;

    // Delete recording files (only inside recordings dir)
    for entry in &entries {
        if let Some(ref path) = entry.recording_path {
            if let Ok(p) = validate_recording_path(path) {
                let _ = std::fs::remove_file(p);
            }
        }
    }

    // Delete all rows from the table
    manager
        .clear_all()
        .map_err(|e| format!("Failed to clear history: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn get_recording_data(recording_path: String) -> Result<Vec<u8>, String> {
    let validated = validate_recording_path(&recording_path)?;
    // Cap at 50MB to avoid OOM for very long recordings
    if let Ok(meta) = std::fs::metadata(&validated) {
        if meta.len() > 50 * 1024 * 1024 {
            return Err("Recording too large (>50MB)".into());
        }
    }
    let settings = crate::settings::AppSettings::load();
    if !settings.noise_suppression_enabled {
        return std::fs::read(&validated).map_err(|e| format!("Failed to read recording: {}", e));
    }
    let (samples, sr) = crate::audio::load_wav(validated.to_str().unwrap_or(&recording_path))?;
    let denoised = crate::audio::suppress_noise(&samples, sr, settings.noise_suppression_level);
    crate::audio::wav_bytes_from_samples(&denoised, sr)
}
