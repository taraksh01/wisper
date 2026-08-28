use regex::{NoExpand, Regex};
use rusqlite::{params, Connection, Result as SqlResult};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

const DB_BUSY_TIMEOUT: Duration = Duration::from_millis(5000);

static REGEX_CACHE: OnceLock<Mutex<HashMap<i64, std::sync::Arc<Vec<(Regex, String)>>>>> =
    OnceLock::new();

fn regex_cache() -> &'static Mutex<HashMap<i64, std::sync::Arc<Vec<(Regex, String)>>>> {
    REGEX_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn clear_regex_cache_for(id: i64) {
    if let Some(m) = REGEX_CACHE.get() {
        if let Ok(mut g) = m.lock() {
            g.remove(&id);
        }
    }
}

fn clear_regex_cache_all() {
    if let Some(m) = REGEX_CACHE.get() {
        if let Ok(mut g) = m.lock() {
            g.clear();
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WordEntry {
    pub id: i64,
    pub phrase: String,
    pub variants: String,
    pub case_sensitive: bool,
    pub whole_word: bool,
    pub auto: bool,
    pub hits: i64,
    pub created_at: String,
}

impl WordEntry {
    fn match_forms(&self) -> Vec<String> {
        let mut forms: Vec<String> = self
            .variants
            .split(['\n', ','])
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        let phrase = self.phrase.trim().to_string();
        if !phrase.is_empty() && !forms.iter().any(|f| f == &phrase) {
            forms.push(phrase.clone());
        }
        forms.sort_by(|a, b| b.len().cmp(&a.len()));
        forms
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WordSuggestion {
    pub phrase: String,
    pub variants: Vec<String>,
    pub count: u32,
}

static WORDS_CONN: once_cell::sync::Lazy<Mutex<Connection>> = once_cell::sync::Lazy::new(|| {
    let db_path = WordsManager::db_path();
    let conn = Connection::open(&db_path).unwrap_or_else(|e| {
        eprintln!(
            "[words] failed to open {}: {e} — using in-memory DB",
            db_path.display()
        );
        Connection::open_in_memory().unwrap_or_else(|e2| {
            eprintln!("[words] in-memory fallback also failed: {e2}");
            panic!("Failed to open words DB");
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
        "CREATE TABLE IF NOT EXISTS words (
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
    ) {
        eprintln!("[words] failed to create table: {e}");
    }
    Mutex::new(conn)
});

pub struct WordsManager;

impl WordsManager {
    pub fn new() -> Self {
        let _ = &*WORDS_CONN;
        Self
    }

    fn conn() -> std::sync::MutexGuard<'static, Connection> {
        WORDS_CONN.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn db_path() -> PathBuf {
        let mut path = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
        path.push(crate::app_info::data_dir_name());
        let _ = std::fs::create_dir_all(&path);
        path.push("words.db");
        path
    }

    pub fn all(&self) -> SqlResult<Vec<WordEntry>> {
        let conn = Self::conn();
        let mut stmt = conn.prepare(
            "SELECT id, phrase, variants, case_sensitive, whole_word, auto, hits, created_at
             FROM words ORDER BY hits DESC, id DESC",
        )?;
        let rows = stmt
            .query_map([], |row| {
                Ok(WordEntry {
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
        let conn = Self::conn();
        conn.execute(
            "INSERT INTO words (phrase, variants, case_sensitive, whole_word, auto)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                phrase,
                variants,
                case_sensitive as i64,
                whole_word as i64,
                auto as i64
            ],
        )?;
        let id = conn.last_insert_rowid();
        drop(conn);
        clear_regex_cache_all();
        Ok(id)
    }

    pub fn update(
        &self,
        id: i64,
        phrase: &str,
        variants: &str,
        case_sensitive: bool,
        whole_word: bool,
    ) -> SqlResult<()> {
        let conn = Self::conn();
        conn.execute(
            "UPDATE words SET phrase = ?1, variants = ?2, case_sensitive = ?3, whole_word = ?4
             WHERE id = ?5",
            params![
                phrase,
                variants,
                case_sensitive as i64,
                whole_word as i64,
                id
            ],
        )?;
        drop(conn);
        clear_regex_cache_for(id);
        Ok(())
    }

    pub fn delete(&self, id: i64) -> SqlResult<()> {
        let conn = Self::conn();
        conn.execute("DELETE FROM words WHERE id = ?1", params![id])?;
        drop(conn);
        clear_regex_cache_for(id);
        Ok(())
    }

    fn bump_hits(&self, id: i64) {
        let conn = WORDS_CONN.lock().unwrap_or_else(|e| e.into_inner());
        let _ = conn.execute(
            "UPDATE words SET hits = hits + 1 WHERE id = ?1",
            params![id],
        );
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
        let conn = Self::conn();
        conn.execute(
            "INSERT OR IGNORE INTO ignored_terms (term) VALUES (?1)",
            params![term],
        )?;
        Ok(())
    }

    pub fn remove_ignored(&self, term: &str) -> SqlResult<()> {
        let conn = Self::conn();
        conn.execute(
            "DELETE FROM ignored_terms WHERE term = ?1",
            params![term.to_lowercase()],
        )?;
        Ok(())
    }

    fn ignored_terms(&self) -> std::collections::HashSet<String> {
        let mut set = std::collections::HashSet::new();
        let conn = WORDS_CONN.lock().unwrap_or_else(|e| e.into_inner());
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
        let conn = Self::conn();
        let mut stmt = conn.prepare("SELECT term FROM ignored_terms")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        Ok(rows.flatten().collect())
    }
}

pub fn apply_words(text: &str) -> String {
    let mgr = WordsManager::new();
    let entries = match mgr.all() {
        Ok(e) => e,
        Err(_) => return text.to_string(),
    };

    let mut out = text.to_string();
    for entry in &entries {
        let phrase = entry.phrase.trim().to_string();
        if phrase.is_empty() {
            continue;
        }
        // Get or build cached regexes for this entry (Arc avoids cloning Regex per word)
        let regexes: std::sync::Arc<Vec<(Regex, String)>> = {
            let mut cache = regex_cache().lock().unwrap_or_else(|e| e.into_inner());
            if let Some(v) = cache.get(&entry.id) {
                std::sync::Arc::clone(v)
            } else {
                let mut vec = Vec::new();
                for form in entry.match_forms() {
                    let escaped = regex::escape(&form);
                    // Both delimiters captured so they survive replacement
                    // (plain `regex` crate has no lookaround support)
                    let pattern = if entry.whole_word {
                        format!(r"(^|[^A-Za-z0-9_]){}($|[^A-Za-z0-9_])", escaped)
                    } else {
                        escaped
                    };
                    let built = if entry.case_sensitive {
                        Regex::new(&pattern)
                    } else {
                        Regex::new(&format!("(?i){}", pattern))
                    };
                    if let Ok(re) = built {
                        vec.push((re, phrase.clone()));
                    }
                }
                let arc = std::sync::Arc::new(vec);
                cache.insert(entry.id, std::sync::Arc::clone(&arc));
                arc
            }
        };
        let mut matched = false;
        for (re, ph) in regexes.iter() {
            // Single pass: replace_all already returns borrowed if no match
            let replaced = if entry.whole_word {
                let safe_ph = ph.replace('$', "$$");
                re.replace_all(&out, format!("${{1}}{}${{2}}", safe_ph))
                    .into_owned()
            } else {
                re.replace_all(&out, NoExpand(ph.as_str())).into_owned()
            };
            if replaced != out {
                out = replaced;
                matched = true;
            }
        }
        if matched {
            mgr.bump_hits(entry.id);
        }
    }
    out
}

/// Builds the dictionary hint containing ONLY entries whose spoken forms
/// actually appear in this transcript — keeps input tokens near-zero no matter
/// how large the dictionary is. (The deterministic `apply_words` post-pass
/// still enforces every entry after the AI, so nothing is lost by filtering.)
pub fn words_prompt_hint(text: &str) -> String {
    let mgr = WordsManager::new();
    let entries = match mgr.all() {
        Ok(e) if !e.is_empty() => e,
        _ => return String::new(),
    };
    let lower = text.to_lowercase();

    let mut lines = Vec::new();
    for e in entries.iter() {
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

        // Relevance check: any canonical form present in this transcript?
        let mut relevant = lower.contains(&phrase.to_lowercase());
        if !relevant {
            for v in &variants {
                if lower.contains(&v.to_lowercase()) {
                    relevant = true;
                    break;
                }
            }
        }
        if !relevant {
            continue;
        }

        if variants.is_empty() {
            lines.push(format!("- \"{}\"", phrase));
        } else {
            for v in variants {
                lines.push(format!("- \"{}\" → \"{}\"", v, phrase));
            }
        }
        // Hard cap for pathological transcripts that match many entries
        if lines.len() >= 30 {
            break;
        }
    }
    if lines.is_empty() {
        return String::new();
    }
    format!(
        "\n\nCRITICAL — User dictionary — you MUST replace any spoken form below (including misspellings, spaced or cased variants) with the exact canonical form shown. Never output the variants:\n{}",
        lines.join("\n")
    )
}

#[tauri::command]
pub fn get_words() -> Result<Vec<WordEntry>, String> {
    WordsManager::new().all().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_word_entry(
    phrase: String,
    variants: String,
    case_sensitive: bool,
    whole_word: bool,
    auto: bool,
) -> Result<i64, String> {
    if phrase.trim().is_empty() {
        return Err("Phrase cannot be empty".into());
    }
    WordsManager::new()
        .add(&phrase, &variants, case_sensitive, whole_word, auto)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_word_entry(
    id: i64,
    phrase: String,
    variants: String,
    case_sensitive: bool,
    whole_word: bool,
) -> Result<(), String> {
    WordsManager::new()
        .update(id, &phrase, &variants, case_sensitive, whole_word)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_word_entry(id: i64) -> Result<(), String> {
    WordsManager::new().delete(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ignore_word_suggestion(term: String) -> Result<(), String> {
    WordsManager::new().ignore(&term).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_ignored_terms() -> Result<Vec<String>, String> {
    WordsManager::new()
        .ignored_list()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn unignore_word_term(term: String) -> Result<(), String> {
    WordsManager::new()
        .remove_ignored(&term)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_ignored_to_dictionary(term: String) -> Result<(), String> {
    let phrase = term.trim().to_string();
    if phrase.is_empty() {
        return Err("Term cannot be empty".into());
    }
    let mgr = WordsManager::new();
    let _ = mgr.remove_ignored(&phrase);
    let variants = casing_variants(&phrase).join(", ");
    mgr.add(&phrase, &variants, false, true, true)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn suggest_words() -> Result<Vec<WordSuggestion>, String> {
    tauri::async_runtime::spawn_blocking(suggest_words_inner)
        .await
        .map_err(|_| "Words scan failed unexpectedly".to_string())?
}

fn suggest_words_inner() -> Result<Vec<WordSuggestion>, String> {
    let known = WordsManager::new().known_terms();
    let ignored = WordsManager::new().ignored_terms();
    let user_limit = crate::settings::AppSettings::load().max_history_entries;
    let limit = if user_limit > 0 {
        (user_limit as i64).clamp(50, 2000)
    } else {
        500
    };
    let history = crate::history::HistoryManager::new()
        .get_history(limit, 0)
        .map_err(|e| e.to_string())?;

    // Correction-based: find words where raw != formatted (AI or manual edit) and propose that correction.
    // Aggregated per LOWERCASED word so casing differences and multiple misheard
    // forms collapse into ONE suggestion row.
    #[derive(Default)]
    struct WordAgg {
        casings: HashMap<String, usize>,
        variants: HashMap<String, usize>,
        total: usize,
    }
    let mut corrections: HashMap<String, WordAgg> = HashMap::new();
    for entry in &history {
        let raw = entry.raw_text.trim();
        let fmt = match &entry.formatted_text {
            Some(f) if !f.trim().is_empty() && f != raw => f.trim().to_string(),
            _ => continue,
        };
        if raw.is_empty() || fmt.is_empty() {
            continue;
        }
        // Simple word-level diff: tokens in formatted but not in raw (and vice versa)
        let raw_words: Vec<&str> = raw
            .split(|c: char| !(c.is_alphanumeric() || c == '_'))
            .filter(|s| !s.trim().is_empty())
            .collect();
        let fmt_words: Vec<&str> = fmt
            .split(|c: char| !(c.is_alphanumeric() || c == '_'))
            .filter(|s| !s.trim().is_empty())
            .collect();
        let raw_set: std::collections::HashSet<String> =
            raw_words.iter().map(|s| s.to_lowercase()).collect();
        let fmt_set: std::collections::HashSet<String> =
            fmt_words.iter().map(|s| s.to_lowercase()).collect();
        for fw in &fmt_words {
            let low = fw.to_lowercase();
            if low.chars().count() < 3
                || is_common_word(&low)
                || known.contains(&low)
                || ignored.contains(&low)
            {
                continue;
            }
            if !raw_set.contains(&low) {
                // Word appears in formatted but not in raw — likely a correction; find closest raw word as variant
                // For now use the lowercased raw word that is most similar (simple: first raw word not in fmt)
                let mut variant = String::new();
                for rw in &raw_words {
                    let rlow = rw.to_lowercase();
                    if !fmt_set.contains(&rlow)
                        && !known.contains(&rlow)
                        && !ignored.contains(&rlow)
                    {
                        variant = (*rw).to_string();
                        break;
                    }
                }
                let agg = corrections.entry(low.clone()).or_default();
                agg.total += 1;
                *agg.casings.entry(fw.to_string()).or_insert(0) += 1;
                if !variant.is_empty() && variant.to_lowercase() != low {
                    *agg.variants.entry(variant).or_insert(0) += 1;
                }
            }
        }
    }

    let mut out: Vec<WordSuggestion> = corrections
        .into_iter()
        .filter(|(_, agg)| agg.total >= 2)
        .map(|(low, agg)| {
            // Display the casing the user actually wrote most often
            let phrase = agg
                .casings
                .into_iter()
                .max_by_key(|(_, c)| *c)
                .map(|(k, _)| k)
                .unwrap_or_else(|| low.clone());
            // Most frequent misheard forms first
            let mut variants: Vec<(String, usize)> = agg.variants.into_iter().collect();
            variants.sort_by(|a, b| b.1.cmp(&a.1));
            WordSuggestion {
                phrase,
                variants: variants.into_iter().map(|(v, _)| v).collect(),
                count: agg.total as u32,
            }
        })
        .collect();
    // Fallback: if no corrections found, don't suggest anything (avoid noisy frequency list)
    out.sort_by(|a, b| b.count.cmp(&a.count));
    out.truncate(20);
    Ok(out)
}

pub fn maybe_auto_add_corrections(raw: &str, formatted: &str) {
    if raw.trim() == formatted.trim() {
        return;
    }
    let mut known = WordsManager::new().known_terms();
    let ignored = WordsManager::new().ignored_terms();
    let raw_words: Vec<&str> = raw
        .split(|c: char| !(c.is_alphanumeric() || c == '_'))
        .filter(|s| !s.trim().is_empty())
        .collect();
    let fmt_words: Vec<&str> = formatted
        .split(|c: char| !(c.is_alphanumeric() || c == '_'))
        .filter(|s| !s.trim().is_empty())
        .collect();
    let raw_set: std::collections::HashSet<String> =
        raw_words.iter().map(|s| s.to_lowercase()).collect();
    let fmt_set: std::collections::HashSet<String> =
        fmt_words.iter().map(|s| s.to_lowercase()).collect();
    // Load history once — not per-word (was N+1); respect user's retention limit
    let user_limit = crate::settings::AppSettings::load().max_history_entries;
    let limit = if user_limit > 0 {
        (user_limit as i64).clamp(50, 2000)
    } else {
        500
    };
    let history = crate::history::HistoryManager::new()
        .get_history(limit, 0)
        .unwrap_or_default();
    for fw in &fmt_words {
        let low = fw.to_lowercase();
        if low.chars().count() < 3
            || is_common_word(&low)
            || known.contains(&low)
            || ignored.contains(&low)
        {
            continue;
        }
        if !raw_set.contains(&low) {
            let mut variant = String::new();
            for rw in &raw_words {
                let rlow = rw.to_lowercase();
                if !fmt_set.contains(&rlow) && !known.contains(&rlow) && !ignored.contains(&rlow) {
                    variant = (*rw).to_string();
                    break;
                }
            }
            // Count occurrences of this correction in history (including current)
            let mut count = 1; // current occurrence
            for entry in &history {
                let r = entry.raw_text.trim();
                let f = match &entry.formatted_text {
                    Some(f) if !f.trim().is_empty() && f != r => f.trim().to_string(),
                    _ => continue,
                };
                let r_set: std::collections::HashSet<String> = r
                    .split(|c: char| !(c.is_alphanumeric() || c == '_'))
                    .filter(|s| !s.trim().is_empty())
                    .map(|s| s.to_lowercase())
                    .collect();
                let f_set: std::collections::HashSet<String> = f
                    .split(|c: char| !(c.is_alphanumeric() || c == '_'))
                    .filter(|s| !s.trim().is_empty())
                    .map(|s| s.to_lowercase())
                    .collect();
                if f_set.contains(&low) && !r_set.contains(&low) {
                    // Check if the same variant was involved
                    if variant.is_empty() || r_set.contains(&variant.to_lowercase()) {
                        count += 1;
                    }
                }
            }
            if count >= 2 {
                let mgr = WordsManager::new();
                let _ = mgr.add(fw, &variant, false, true, true);
                known.insert(low.clone());
            }
        }
    }
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

const COMMON_WORDS: &[&str] = &[
    "the", "be", "to", "of", "and", "a", "in", "that", "have", "it", "for", "not", "on", "with",
    "he", "as", "you", "do", "at", "this", "but", "his", "by", "from", "they", "we", "say", "her",
    "she", "or", "an", "will", "my", "one", "all", "would", "there", "their", "what", "so", "up",
    "out", "if", "about", "who", "get", "which", "go", "me", "when", "make", "can", "like", "time",
    "no", "just", "him", "know", "take", "people", "into", "year", "your", "good", "some", "could",
    "them", "see", "other", "than", "then", "now", "look", "only", "come", "its", "over", "think",
    "also", "back", "after", "use", "two", "how", "our", "work", "first", "well", "way", "even",
    "new", "want", "because", "any", "these", "give", "day", "most", "us", "should", "shall", "may",
    "might", "must", "has", "had", "were", "been", "being", "are", "was", "is", "am", "does", "did",
    "ought", "need", "dare", "used",
];

fn is_common_word(low: &str) -> bool {
    COMMON_WORDS.contains(&low)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replaces_known_term() {
        let mgr = WordsManager::new();
        // Isolate: clear any prior state that could pollute the test DB
        let _ = mgr.all().and_then(|all| {
            for e in all {
                if e.phrase == "Wisper" {
                    mgr.delete(e.id)?;
                }
            }
            Ok::<_, rusqlite::Error>(())
        });
        clear_regex_cache_all();
        let id = mgr
            .add("Wisper", "Whisper", false, true, false)
            .expect("insert");
        let out = apply_words("I use whisper daily");
        assert_eq!(out, "I use Wisper daily");
        let _ = mgr.delete(id);
        clear_regex_cache_all();
    }
}
