use regex::{NoExpand, Regex};
use rusqlite::{params, Connection, Result as SqlResult};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VocabEntry {
    pub id: i64,
    pub phrase: String,
    pub variants: String,
    pub case_sensitive: bool,
    pub whole_word: bool,
    pub auto: bool,
    pub hits: i64,
    pub created_at: String,
}

impl VocabEntry {
    fn match_forms(&self) -> Vec<String> {
        let mut forms: Vec<String> = self
            .variants
            .split(['\n', ','])
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        let phrase = self.phrase.trim().to_string();
        if !phrase.is_empty() && !forms.iter().any(|f| f == &phrase) {
            forms.push(phrase);
        }
        forms.sort_by(|a, b| b.len().cmp(&a.len()));
        forms
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VocabSuggestion {
    pub phrase: String,
    pub variants: Vec<String>,
    pub count: u32,
}

pub struct VocabManager {
    conn: Mutex<Connection>,
}

impl VocabManager {
    pub fn new() -> Self {
        let db_path = Self::db_path();
        let conn = Connection::open(&db_path).expect("Failed to open vocabulary database");
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS vocabulary (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                phrase TEXT NOT NULL,
                variants TEXT DEFAULT '',
                case_sensitive INTEGER DEFAULT 0,
                whole_word INTEGER DEFAULT 1,
                auto INTEGER DEFAULT 0,
                hits INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS ignored_terms (
                term TEXT PRIMARY KEY COLLATE NOCASE
            );",
        )
        .expect("Failed to create vocabulary table");
        Self {
            conn: Mutex::new(conn),
        }
    }

    fn db_path() -> PathBuf {
        let mut path = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
        path.push("wisper");
        let _ = std::fs::create_dir_all(&path);
        path.push("vocabulary.db");
        path
    }

    pub fn all(&self) -> SqlResult<Vec<VocabEntry>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, phrase, variants, case_sensitive, whole_word, auto, hits, created_at
             FROM vocabulary ORDER BY hits DESC, id DESC",
        )?;
        let rows = stmt
            .query_map([], |row| {
                Ok(VocabEntry {
                    id: row.get(0)?,
                    phrase: row.get(1)?,
                    variants: row.get(2)?,
                    case_sensitive: row.get::<_, i64>(3)? != 0,
                    whole_word: row.get::<_, i64>(4)? != 0,
                    auto: row.get::<_, i64>(5)? != 0,
                    hits: row.get(6)?,
                    created_at: row.get(7)?,
                })
            })?
            .collect::<SqlResult<Vec<_>>>()?;
        Ok(rows)
    }

    pub fn add(
        &self,
        phrase: &str,
        variants: &str,
        case_sensitive: bool,
        whole_word: bool,
        auto: bool,
    ) -> SqlResult<i64> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO vocabulary (phrase, variants, case_sensitive, whole_word, auto)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![phrase, variants, case_sensitive as i64, whole_word as i64, auto as i64],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn update(
        &self,
        id: i64,
        phrase: &str,
        variants: &str,
        case_sensitive: bool,
        whole_word: bool,
    ) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE vocabulary SET phrase = ?1, variants = ?2, case_sensitive = ?3, whole_word = ?4
             WHERE id = ?5",
            params![phrase, variants, case_sensitive as i64, whole_word as i64, id],
        )?;
        Ok(())
    }

    pub fn delete(&self, id: i64) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM vocabulary WHERE id = ?1", params![id])?;
        Ok(())
    }

    fn bump_hits(&self, id: i64) {
        if let Ok(conn) = self.conn.lock() {
            let _ = conn.execute("UPDATE vocabulary SET hits = hits + 1 WHERE id = ?1", params![id]);
        }
    }

    fn known_terms(&self) -> std::collections::HashSet<String> {
        let mut set = std::collections::HashSet::new();
        if let Ok(entries) = self.all() {
            for e in entries {
                set.insert(e.phrase.to_lowercase());
                for v in e.variants.split(['\n', ',']) {
                    let v = v.trim();
                    if !v.is_empty() {
                        set.insert(v.to_lowercase());
                    }
                }
            }
        }
        set
    }

    pub fn ignore(&self, term: &str) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR IGNORE INTO ignored_terms (term) VALUES (?1)",
            params![term],
        )?;
        Ok(())
    }

    pub fn remove_ignored(&self, term: &str) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM ignored_terms WHERE term = ?1",
            params![term.to_lowercase()],
        )?;
        Ok(())
    }

    fn ignored_terms(&self) -> std::collections::HashSet<String> {
        let mut set = std::collections::HashSet::new();
        let conn = match self.conn.lock() {
            Ok(c) => c,
            Err(_) => return set,
        };
        if let Ok(mut stmt) = conn.prepare("SELECT term FROM ignored_terms") {
            if let Ok(rows) = stmt.query_map([], |row| row.get::<_, String>(0)) {
                for t in rows.flatten() {
                    set.insert(t.to_lowercase());
                }
            }
        }
        set
    }

    pub fn ignored_list(&self) -> SqlResult<Vec<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT term FROM ignored_terms")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        Ok(rows.flatten().collect())
    }
}

pub fn apply_vocabulary(text: &str) -> String {
    let mgr = VocabManager::new();
    let entries = match mgr.all() {
        Ok(e) => e,
        Err(_) => return text.to_string(),
    };

    let mut out = text.to_string();
    for entry in &entries {
        let phrase = entry.phrase.trim();
        if phrase.is_empty() {
            continue;
        }
        let mut matched = false;
        for form in entry.match_forms() {
            let escaped = regex::escape(&form);
            let pattern = if entry.whole_word {
                format!(r"(?:\b|_){}(?:\b|_)", escaped)
            } else {
                escaped
            };
            let built = if entry.case_sensitive {
                Regex::new(&pattern)
            } else {
                Regex::new(&format!("(?i){}", pattern))
            };
            if let Ok(re) = built {
                if re.is_match(&out) {
                    let replaced = re.replace_all(&out, NoExpand(phrase)).into_owned();
                    if replaced != out {
                        out = replaced;
                        matched = true;
                    }
                }
            }
        }
        if matched {
            mgr.bump_hits(entry.id);
        }
    }
    out
}

pub fn vocabulary_prompt_hint() -> String {
    let mgr = VocabManager::new();
    let entries = match mgr.all() {
        Ok(e) if !e.is_empty() => e,
        _ => return String::new(),
    };

    let mut lines = Vec::new();
    for e in entries.iter().take(60) {
        let phrase = e.phrase.trim();
        if phrase.is_empty() {
            continue;
        }
        let variants: Vec<&str> = e
            .variants
            .split(['\n', ','])
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .collect();
        if variants.is_empty() {
            lines.push(format!("- {}", phrase));
        } else {
            lines.push(format!("- {} (not: {})", phrase, variants.join(", ")));
        }
    }
    if lines.is_empty() {
        return String::new();
    }
    format!(
        "\n\nPreferred spellings — when a term below (or a close misspelling of it) appears, always output the exact canonical form shown:\n{}",
        lines.join("\n")
    )
}

#[tauri::command]
pub fn get_vocabulary() -> Result<Vec<VocabEntry>, String> {
    VocabManager::new().all().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_vocab_entry(
    phrase: String,
    variants: String,
    case_sensitive: bool,
    whole_word: bool,
    auto: bool,
) -> Result<i64, String> {
    if phrase.trim().is_empty() {
        return Err("Phrase cannot be empty".into());
    }
    VocabManager::new()
        .add(phrase.trim(), variants.trim(), case_sensitive, whole_word, auto)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_vocab_entry(
    id: i64,
    phrase: String,
    variants: String,
    case_sensitive: bool,
    whole_word: bool,
) -> Result<(), String> {
    if phrase.trim().is_empty() {
        return Err("Phrase cannot be empty".into());
    }
    VocabManager::new()
        .update(id, phrase.trim(), variants.trim(), case_sensitive, whole_word)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_vocab_entry(id: i64) -> Result<(), String> {
    VocabManager::new().delete(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ignore_vocab_suggestion(term: String) -> Result<(), String> {
    VocabManager::new().ignore(&term).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_ignored_terms() -> Result<Vec<String>, String> {
    VocabManager::new().ignored_list().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn unignore_vocab_term(term: String) -> Result<(), String> {
    VocabManager::new().remove_ignored(&term).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_ignored_to_dictionary(term: String) -> Result<(), String> {
    let phrase = term.trim().to_string();
    if phrase.is_empty() {
        return Err("Term cannot be empty".into());
    }
    let mgr = VocabManager::new();
    let _ = mgr.remove_ignored(&phrase);
    let variants = casing_variants(&phrase).join(", ");
    mgr.add(&phrase, &variants, false, true, true)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn suggest_vocabulary() -> Result<Vec<VocabSuggestion>, String> {
    tauri::async_runtime::spawn_blocking(suggest_vocabulary_inner)
        .await
        .map_err(|_| "Vocabulary scan failed unexpectedly".to_string())?
}

fn suggest_vocabulary_inner() -> Result<Vec<VocabSuggestion>, String> {
    let known = VocabManager::new().known_terms();
    let ignored = VocabManager::new().ignored_terms();
    let history = crate::history::HistoryManager::new()
        .get_history(300)
        .map_err(|e| e.to_string())?;

    let mut counts: HashMap<String, u32> = HashMap::new();
    for entry in &history {
        let text = entry.formatted_text.clone().unwrap_or_else(|| entry.raw_text.clone());
        for raw in text.split(|c: char| !(c.is_alphanumeric() || c == '_')) {
            let tok = raw.trim();
            if tok.chars().count() < 3 {
                continue;
            }
            if !is_candidate_term(tok) {
                continue;
            }
            let lower = tok.to_lowercase();
            if known.contains(&lower) || ignored.contains(&lower) {
                continue;
            }
            *counts.entry(tok.to_string()).or_default() += 1;
        }
    }

    let mut candidates: Vec<(String, u32)> = counts.into_iter().filter(|(_, c)| *c >= 2).collect();
    candidates.sort_by(|a, b| b.1.cmp(&a.1));
    candidates.truncate(40);

    Ok(candidates
        .into_iter()
        .map(|(phrase, count)| VocabSuggestion {
            phrase: phrase.clone(),
            variants: casing_variants(&phrase),
            count,
        })
        .collect())
}

fn casing_variants(tok: &str) -> Vec<String> {
    let lower = tok.to_lowercase();
    let upper = tok.to_uppercase();
    let title: String = tok
        .chars()
        .enumerate()
        .map(|(i, c)| {
            if i == 0 {
                c.to_uppercase().next().unwrap_or(c)
            } else {
                c.to_lowercase().next().unwrap_or(c)
            }
        })
        .collect();
    let mut variants = Vec::new();
    if lower != tok {
        variants.push(lower);
    }
    if upper != tok {
        variants.push(upper);
    }
    if title != tok && !variants.contains(&title) {
        variants.push(title);
    }
    variants
}

fn is_candidate_term(tok: &str) -> bool {
    let has_underscore_or_digit = tok.chars().any(|c| c == '_' || c.is_ascii_digit());
    let all_caps = tok.chars().all(|c| c.is_uppercase() || !c.is_alphabetic())
        && tok.chars().any(|c| c.is_uppercase());
    let mut chars = tok.chars();
    let _first = chars.next();
    let internal_caps = chars.any(|c| c.is_uppercase());
    has_underscore_or_digit || all_caps || internal_caps
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(phrase: &str, variants: &str, cs: bool, ww: bool) -> VocabEntry {
        VocabEntry {
            id: 0,
            phrase: phrase.into(),
            variants: variants.into(),
            case_sensitive: cs,
            whole_word: ww,
            auto: false,
            hits: 0,
            created_at: String::new(),
        }
    }

    fn apply(entries: &[VocabEntry], text: &str) -> String {
        let mut out = text.to_string();
        for e in entries {
            let phrase = e.phrase.trim();
            for form in e.match_forms() {
                let escaped = regex::escape(&form);
                let pattern = if e.whole_word {
                    format!(r"(?:\b|_){}(?:\b|_)", escaped)
                } else {
                    escaped
                };
                let re = if e.case_sensitive {
                    Regex::new(&pattern).unwrap()
                } else {
                    Regex::new(&format!("(?i){}", pattern)).unwrap()
                };
                out = re.replace_all(&out, NoExpand(phrase)).into_owned();
            }
        }
        out
    }

    #[test]
    fn fixes_casing_of_canonical_form() {
        let e = vec![entry("Wisper", "whisper", false, true)];
        assert_eq!(apply(&e, "I ran the whisper command"), "I ran the Wisper command");
        assert_eq!(apply(&e, "use WISPER here"), "use Wisper here");
    }

    #[test]
    fn whole_word_does_not_touch_substrings() {
        let e = vec![entry("Wisper", "whisper", false, true)];
        assert_eq!(apply(&e, "whispering softly"), "whispering softly");
    }

    #[test]
    fn multiword_variant() {
        let e = vec![entry("Kubernetes", "cube net ease, kubernetis", false, true)];
        assert_eq!(apply(&e, "deploy to cube net ease now"), "deploy to Kubernetes now");
    }
}
