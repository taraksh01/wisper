use rusqlite::{params, Connection, Result as SqlResult};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

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

pub struct HistoryManager {
    conn: Mutex<Connection>,
}

impl HistoryManager {
    pub fn new() -> Self {
        let db_path = Self::get_db_path();
        let conn = Connection::open(&db_path).expect("Failed to open history database");
        conn.execute_batch(
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
        )
        .expect("Failed to create history table");

        // Migration: add recording_path column if missing on existing databases
        let _ = conn.execute("ALTER TABLE history ADD COLUMN recording_path TEXT", []);

        Self {
            conn: Mutex::new(conn),
        }
    }

    fn get_db_path() -> PathBuf {
        let mut path = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
        path.push("v3");
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
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO history (raw_text, formatted_text, agent_name, duration_ms, word_count, recording_path)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![raw_text, formatted_text, agent_name, duration_ms, word_count, recording_path],
        )?;
        Ok(())
    }

    pub fn update(&self, id: i64, raw_text: &str, formatted_text: Option<&str>) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE history SET raw_text = ?1, formatted_text = ?2 WHERE id = ?3",
            params![raw_text, formatted_text, id],
        )?;
        Ok(())
    }

    pub fn delete(&self, id: i64) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM history WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn get_history(&self, limit: i64) -> SqlResult<Vec<HistoryEntry>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, raw_text, formatted_text, agent_name, duration_ms, word_count, created_at, recording_path
             FROM history ORDER BY id DESC LIMIT ?1",
        )?;

        let entries = stmt
            .query_map(params![limit], |row| {
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
        let conn = self.conn.lock().unwrap();
        let total: i64 = conn.query_row("SELECT COUNT(*) FROM history", [], |row| row.get(0))?;
        let total_words: i64 =
            conn.query_row("SELECT COALESCE(SUM(word_count), 0) FROM history", [], |row| {
                row.get(0)
            })?;
        let avg_words: f64 = if total > 0 {
            total_words as f64 / total as f64
        } else {
            0.0
        };
        Ok((total, total_words, avg_words))
    }

    pub fn clear_all(&self) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM history", [])?;
        Ok(())
    }

    pub fn get_recording_dir() -> PathBuf {
        let mut path = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
        path.push("v3");
        path.push("recordings");
        let _ = std::fs::create_dir_all(&path);
        path
    }
}

pub fn save_recording_to_disk(samples: &[f32], sample_rate: u32) -> Option<String> {
    let dir = HistoryManager::get_recording_dir();
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let filename = format!("v3_{}.wav", timestamp);
    let path = dir.join(&filename);

    match wav_from_samples(samples, sample_rate, &path) {
        Ok(_) => Some(path.to_string_lossy().to_string()),
        Err(e) => {
            eprintln!("Failed to save recording: {}", e);
            None
        }
    }
}

fn wav_from_samples(samples: &[f32], sample_rate: u32, path: &std::path::Path) -> Result<(), String> {
    use std::io::Write;

    let mut raw = Vec::with_capacity(samples.len() * 2);
    for &s in samples {
        let clamped = s.clamp(-1.0, 1.0);
        let sample = (clamped * i16::MAX as f32) as i16;
        raw.extend_from_slice(&sample.to_le_bytes());
    }

    let data_size = raw.len() as u32;
    let file_size = 36 + data_size;

    let mut f = std::fs::File::create(path).map_err(|e| e.to_string())?;
    f.write_all(b"RIFF").map_err(|e| e.to_string())?;
    f.write_all(&file_size.to_le_bytes()).map_err(|e| e.to_string())?;
    f.write_all(b"WAVE").map_err(|e| e.to_string())?;
    f.write_all(b"fmt ").map_err(|e| e.to_string())?;
    f.write_all(&16u32.to_le_bytes()).map_err(|e| e.to_string())?; // chunk size
    f.write_all(&1u16.to_le_bytes()).map_err(|e| e.to_string())?;  // PCM
    f.write_all(&1u16.to_le_bytes()).map_err(|e| e.to_string())?;  // mono
    f.write_all(&sample_rate.to_le_bytes()).map_err(|e| e.to_string())?;
    f.write_all(&(sample_rate * 2u32).to_le_bytes()).map_err(|e| e.to_string())?; // byte rate
    f.write_all(&2u16.to_le_bytes()).map_err(|e| e.to_string())?;  // block align
    f.write_all(&16u16.to_le_bytes()).map_err(|e| e.to_string())?; // bits per sample
    f.write_all(b"data").map_err(|e| e.to_string())?;
    f.write_all(&data_size.to_le_bytes()).map_err(|e| e.to_string())?;
    f.write_all(&raw).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn get_history_entries(limit: i64) -> Result<Vec<HistoryEntry>, String> {
    let manager = HistoryManager::new();
    manager
        .get_history(limit)
        .map_err(|e| format!("Failed to get history: {}", e))
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
pub fn update_history_entry(id: i64, raw_text: String, formatted_text: Option<String>) -> Result<(), String> {
    let manager = HistoryManager::new();
    manager
        .update(id, &raw_text, formatted_text.as_deref())
        .map_err(|e| format!("Failed to update history entry: {}", e))
}

#[tauri::command]
pub fn retranscribe_recording(recording_path: String) -> Result<String, String> {
    let (samples, sample_rate) = crate::audio::load_wav(&recording_path)?;

    // Load the current model from settings
    let settings = crate::settings::AppSettings::load();
    let model_dir = crate::models::get_models_dir();
    let model_path = model_dir.join(&settings.local_model_file);

    if !model_path.exists() {
        return Err(format!("Model file not found: {:?}", model_path));
    }

    let provider = crate::stt::create_local_provider(model_path);
    let trimmed = crate::audio::trim_silence(&samples, 1600, 0.01);
    if trimmed.is_empty() {
        return Err("No speech detected in recording".to_string());
    }

    provider.transcribe(&trimmed, sample_rate)
}

#[tauri::command]
pub fn clear_history() -> Result<(), String> {
    let manager = HistoryManager::new();

    // Collect all recording paths before deleting
    let entries = manager
        .get_history(i64::MAX)
        .map_err(|e| format!("Failed to get history: {}", e))?;

    // Delete recording files
    for entry in &entries {
        if let Some(ref path) = entry.recording_path {
            let _ = std::fs::remove_file(path);
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
    std::fs::read(&recording_path).map_err(|e| format!("Failed to read recording: {}", e))
}
