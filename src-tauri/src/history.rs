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
                created_at TEXT DEFAULT (datetime('now'))
            );",
        )
        .expect("Failed to create history table");

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
    ) -> SqlResult<()> {
        let word_count = raw_text.split_whitespace().count() as i64;
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO history (raw_text, formatted_text, agent_name, duration_ms, word_count)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![raw_text, formatted_text, agent_name, duration_ms, word_count],
        )?;
        Ok(())
    }

    pub fn get_history(&self, limit: i64) -> SqlResult<Vec<HistoryEntry>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, raw_text, formatted_text, agent_name, duration_ms, word_count, created_at
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