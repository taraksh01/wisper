//! Dictionary profiles: shareable packs of custom-words entries.
//!
//! The underlying storage stays the existing `words` table (`words.rs`).
//! Importing a profile inserts its entries as regular rows tagged with
//! `profile_id`. Editing a row detaches it (`profile_id = NULL`) so the
//! user's customization survives profile removal. Toggling a profile off
//! makes `apply_words` / `words_prompt_hint` skip its rows without deleting.
//!
//! Bundled profiles are compiled in via `include_str!` (no runtime path
//! resolution, works in dev and prod). Custom profiles are imported from
//! JSON text supplied by the frontend (file picker via `<input type=file>`)
//! or fetched from a URL.

use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

fn default_whole_word() -> bool {
    true
}

/// Accepts `"a, b"` or `["a", "b"]` for ergonomics in hand-written JSON.
fn deserialize_variants<'de, D>(d: D) -> Result<String, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::de::{self, Visitor};
    struct VariantsVisitor;
    impl<'de> Visitor<'de> for VariantsVisitor {
        type Value = String;
        fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
            f.write_str("a string or an array of strings")
        }
        fn visit_str<E: de::Error>(self, v: &str) -> Result<String, E> {
            Ok(v.to_string())
        }
        fn visit_string<E: de::Error>(self, v: String) -> Result<String, E> {
            Ok(v)
        }
        fn visit_seq<A: de::SeqAccess<'de>>(self, mut seq: A) -> Result<String, A::Error> {
            let mut parts: Vec<String> = Vec::new();
            while let Some(s) = seq.next_element::<String>()? {
                parts.push(s);
            }
            Ok(parts.join(", "))
        }
        fn visit_none<E: de::Error>(self) -> Result<String, E> {
            Ok(String::new())
        }
        fn visit_unit<E: de::Error>(self) -> Result<String, E> {
            Ok(String::new())
        }
    }
    d.deserialize_any(VariantsVisitor)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileEntryInput {
    #[serde(default)]
    pub phrase: String,
    #[serde(default, deserialize_with = "deserialize_variants")]
    pub variants: String,
    #[serde(default)]
    pub case_sensitive: bool,
    #[serde(default = "default_whole_word")]
    pub whole_word: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileFile {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub update_url: String,
    #[serde(default)]
    pub entries: Vec<ProfileEntryInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileMeta {
    pub id: String,
    pub name: String,
    pub description: String,
    pub source: String,
    pub version: String,
    pub update_url: String,
    pub entry_count: i64,
    pub active: bool,
    /// For bundled listings: already imported into the DB.
    pub imported: bool,
    pub imported_at: String,
    #[serde(default)]
    pub has_update: bool,
    #[serde(default)]
    pub bundled_entry_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub profile_id: String,
    pub added: i64,
    pub updated: i64,
    pub unchanged: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileUpdate {
    pub profile_id: String,
    pub name: String,
    pub current_version: String,
    pub latest_version: String,
    pub url: String,
}

// ---------------------------------------------------------------------------
// Bundled profiles (compiled in)
// ---------------------------------------------------------------------------

const BUNDLED_DEVELOPER: &str = include_str!("../resources/profiles/developer.json");
const BUNDLED_EMAIL: &str = include_str!("../resources/profiles/email.json");
const BUNDLED_MESSAGING: &str = include_str!("../resources/profiles/messaging.json");
const BUNDLED_GENERAL: &str = include_str!("../resources/profiles/general.json");

fn bundled_jsons() -> Vec<&'static str> {
    vec![
        BUNDLED_DEVELOPER,
        BUNDLED_EMAIL,
        BUNDLED_MESSAGING,
        BUNDLED_GENERAL,
    ]
}

fn content_hash(text: &str) -> String {
    let mut h = DefaultHasher::new();
    text.hash(&mut h);
    format!("{:016x}", h.finish())
}

fn normalize_variants(raw: &str) -> String {
    raw.split([',', '\n'])
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(", ")
}

// ---------------------------------------------------------------------------
// DB helpers (same `words.db` connection as `words.rs`)
// ---------------------------------------------------------------------------

fn imported_map() -> std::collections::HashMap<String, (String, String, bool, String)> {
    // id -> (version, content_hash, active, imported_at)
    let mut map = std::collections::HashMap::new();
    let conn = crate::words::WordsManager::conn();
    let mut stmt = match conn.prepare(
        "SELECT id, version, content_hash, active, imported_at FROM dictionary_profiles",
    ) {
        Ok(s) => s,
        Err(_) => return map,
    };
    if let Ok(rows) = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, i64>(3)? != 0,
            row.get::<_, String>(4)?,
        ))
    }) {
        for r in rows.flatten() {
            map.insert(r.0, (r.1, r.2, r.3, r.4));
        }
    }
    map
}

fn refresh_entry_counts() {
    let conn = crate::words::WordsManager::conn();
    // Recompute for every profile so takeovers / removals can't leave stale counts.
    let ids: Vec<String> = conn
        .prepare("SELECT id FROM dictionary_profiles")
        .and_then(|mut s| {
            s.query_map([], |r| r.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()
        })
        .unwrap_or_default();
    for id in ids {
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM words WHERE profile_id = ?1",
                params![id],
                |r| r.get(0),
            )
            .unwrap_or(0);
        let _ = conn.execute(
            "UPDATE dictionary_profiles SET entry_count = ?1 WHERE id = ?2",
            params![count, id],
        );
    }
}

/// Core import. `raw` is the original JSON text (used for the content hash).
/// Phrase ownership is global and case-insensitive: the importing profile
/// takes over any existing row with the same phrase (including user-detached
/// rows), which makes re-imports idempotent and self-healing.
fn import_profile_text(raw: &str, source: &str) -> Result<ImportResult, String> {
    let pf: ProfileFile =
        serde_json::from_str(raw).map_err(|e| format!("Invalid profile JSON: {e}"))?;
    let id = pf.id.trim().to_string();
    if id.is_empty() {
        return Err("Profile id cannot be empty".into());
    }
    if pf.name.trim().is_empty() {
        return Err("Profile name cannot be empty".into());
    }
    if pf.entries.is_empty() {
        return Err("Profile has no entries".into());
    }
    if id.len() > 128 {
        return Err("Profile id is too long (max 128 chars)".into());
    }

    let hash = content_hash(raw);
    let mgr = crate::words::WordsManager::new();
    {
        let conn = crate::words::WordsManager::conn();
        conn.execute(
            "INSERT INTO dictionary_profiles
                 (id, name, description, source, version, update_url, content_hash, active)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1)
             ON CONFLICT(id) DO UPDATE SET
                 name = excluded.name,
                 description = excluded.description,
                 source = excluded.source,
                 version = excluded.version,
                 update_url = excluded.update_url,
                 content_hash = excluded.content_hash,
                 imported_at = datetime('now')",
            params![
                id,
                pf.name.trim(),
                pf.description.trim(),
                source,
                pf.version.trim(),
                pf.update_url.trim(),
                hash,
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    let mut added = 0i64;
    let mut updated = 0i64;
    let mut unchanged = 0i64;
    for e in &pf.entries {
        let phrase = e.phrase.trim();
        if phrase.is_empty() {
            continue;
        }
        if phrase.len() > 256 {
            continue;
        }
        let variants = normalize_variants(&e.variants);
        // Scope the lookup so the mutex guard drops before any insert/update
        // below (std Mutex is not reentrant — holding it across add_with_profile
        // deadlocks).
        let existing: Option<(i64, String, i64, i64, Option<String>)> = {
            let conn = crate::words::WordsManager::conn();
            conn.query_row(
                "SELECT id, variants, case_sensitive, whole_word, profile_id
                 FROM words WHERE LOWER(phrase) = LOWER(?1) LIMIT 1",
                params![phrase],
                |r| {
                    Ok((
                        r.get(0)?,
                        r.get(1)?,
                        r.get(2)?,
                        r.get(3)?,
                        r.get::<_, Option<String>>(4).unwrap_or(None),
                    ))
                },
            )
            .ok()
        };
        match existing {
            None => {
                mgr.add_with_profile(
                    phrase,
                    &variants,
                    e.case_sensitive,
                    e.whole_word,
                    false,
                    Some(&id),
                )
                .map_err(|e| e.to_string())?;
                added += 1;
            }
            Some((row_id, old_variants, old_cs, old_ww, old_pid)) => {
                let same_content = old_variants == variants
                    && old_cs == (e.case_sensitive as i64)
                    && old_ww == (e.whole_word as i64)
                    && old_pid.as_deref() == Some(id.as_str());
                if same_content {
                    unchanged += 1;
                } else {
                    let conn = crate::words::WordsManager::conn();
                    conn.execute(
                        "UPDATE words SET variants = ?1, case_sensitive = ?2,
                         whole_word = ?3, profile_id = ?4 WHERE id = ?5",
                        params![
                            variants,
                            e.case_sensitive as i64,
                            e.whole_word as i64,
                            id,
                            row_id
                        ],
                    )
                    .map_err(|e| e.to_string())?;
                    updated += 1;
                }
            }
        }
    }
    if added == 0 && updated == 0 && unchanged == 0 {
        return Err("Profile has no valid entries (all phrases empty)".into());
    }
    refresh_entry_counts();
    crate::words::clear_words_regex_cache();
    Ok(ImportResult {
        profile_id: id,
        added,
        updated,
        unchanged,
    })
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn list_bundled_profiles() -> Result<Vec<ProfileMeta>, String> {
    let imported = imported_map();
    let mut out = Vec::new();
    for raw in bundled_jsons() {
        let pf: ProfileFile =
            serde_json::from_str(raw).map_err(|e| format!("Bad bundled profile: {e}"))?;
        let bundled_hash = content_hash(raw);
        let bundled_len = pf.entries.len() as i64;
        let (imported_flag, active, imported_at, entry_count, has_update) =
            match imported.get(&pf.id) {
                Some((imp_ver, imp_hash, a, at)) => {
                    let count = crate::words::WordsManager::conn()
                        .query_row(
                            "SELECT COUNT(*) FROM words WHERE profile_id = ?1",
                            params![pf.id],
                            |r| r.get::<_, i64>(0),
                        )
                        .unwrap_or(0);
                    // Has update if version changed or content hash differs.
                    // Using hash catches entry additions even when version is bumped forgotten.
                    let upd = imp_ver.trim() != pf.version.trim() || imp_hash.trim() != bundled_hash.trim();
                    (true, *a, at.clone(), count, upd)
                }
                None => (false, true, String::new(), bundled_len, false),
            };
        out.push(ProfileMeta {
            id: pf.id,
            name: pf.name,
            description: pf.description,
            source: "bundled".into(),
            version: pf.version,
            update_url: pf.update_url,
            entry_count,
            active,
            imported: imported_flag,
            imported_at,
            has_update,
            bundled_entry_count: bundled_len,
        });
    }
    Ok(out)
}

#[tauri::command]
pub fn list_imported_profiles() -> Result<Vec<ProfileMeta>, String> {
    let conn = crate::words::WordsManager::conn();
    let mut stmt = conn
        .prepare(
            "SELECT id, name, description, source, version, update_url,
                    entry_count, active, imported_at
             FROM dictionary_profiles ORDER BY imported_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(ProfileMeta {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                source: row.get(3)?,
                version: row.get(4)?,
                update_url: row.get(5)?,
                entry_count: row.get(6)?,
                active: row.get::<_, i64>(7)? != 0,
                imported: true,
                imported_at: row.get(8)?,
                has_update: false,
                bundled_entry_count: 0,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
pub fn import_bundled_profile(profile_id: String) -> Result<ImportResult, String> {
    let wanted = profile_id.trim();
    for raw in bundled_jsons() {
        let pf: ProfileFile =
            serde_json::from_str(raw).map_err(|e| format!("Bad bundled profile: {e}"))?;
        if pf.id == wanted {
            return import_profile_text(raw, "bundled");
        }
    }
    Err(format!("No bundled profile with id '{wanted}'"))
}

/// Import from JSON text. The frontend reads the file via `<input type=file>`
/// so no dialog/fs plugin is needed on the Rust side.
#[tauri::command]
pub fn import_profile_from_json(json_text: String) -> Result<ImportResult, String> {
    if json_text.len() > 2_000_000 {
        return Err("Profile file is too large (max 2 MB)".into());
    }
    import_profile_text(&json_text, "imported")
}

#[tauri::command]
pub async fn import_profile_from_url(url: String) -> Result<ImportResult, String> {
    let url = url.trim().to_string();
    if !(url.starts_with("https://") || url.starts_with("http://localhost")) {
        return Err("Only https:// URLs are allowed (http://localhost for testing)".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(20))
            .build()
            .map_err(|e| e.to_string())?;
        let resp = client.get(&url).send().map_err(|e| e.to_string())?;
        let ct = resp
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();
        if !ct.contains("json") && !ct.is_empty() {
            return Err(format!("Unexpected content type '{ct}' (expected JSON)"));
        }
        let text = resp.text().map_err(|e| e.to_string())?;
        if text.len() > 2_000_000 {
            return Err("Downloaded profile is too large (max 2 MB)".into());
        }
        import_profile_text(&text, "downloaded")
    })
    .await
    .map_err(|_| "Profile download failed unexpectedly".to_string())?
}

#[tauri::command]
pub fn set_profile_active(profile_id: String, active: bool) -> Result<(), String> {
    let conn = crate::words::WordsManager::conn();
    let n = conn
        .execute(
            "UPDATE dictionary_profiles SET active = ?1 WHERE id = ?2",
            params![active as i64, profile_id.trim()],
        )
        .map_err(|e| e.to_string())?;
    if n == 0 {
        return Err("Profile not found".into());
    }
    crate::words::clear_words_regex_cache();
    Ok(())
}

/// Deletes all rows owned by the profile plus the profile record.
/// Rows the user edited after import were detached (`profile_id = NULL`)
/// and are kept.
#[tauri::command]
pub fn remove_profile(profile_id: String) -> Result<i64, String> {
    let pid = profile_id.trim().to_string();
    let conn = crate::words::WordsManager::conn();
    let deleted: i64 = {
        let n = conn
            .execute("DELETE FROM words WHERE profile_id = ?1", params![pid])
            .map_err(|e| e.to_string())? as i64;
        conn.execute(
            "DELETE FROM dictionary_profiles WHERE id = ?1",
            params![pid],
        )
        .map_err(|e| e.to_string())?;
        n
    };
    crate::words::clear_words_regex_cache();
    Ok(deleted)
}

fn build_export(profile: &ProfileMeta) -> Result<String, String> {
    let conn = crate::words::WordsManager::conn();
    let mut stmt = conn
        .prepare(
            "SELECT phrase, variants, case_sensitive, whole_word FROM words
             WHERE profile_id = ?1 ORDER BY LOWER(phrase)",
        )
        .map_err(|e| e.to_string())?;
    let entries = stmt
        .query_map(params![profile.id], |row| {
            Ok(ProfileEntryInput {
                phrase: row.get(0)?,
                variants: row.get(1)?,
                case_sensitive: row.get::<_, i64>(2)? != 0,
                whole_word: row.get::<_, i64>(3)? != 0,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    let file = ProfileFile {
        id: profile.id.clone(),
        name: profile.name.clone(),
        description: profile.description.clone(),
        version: profile.version.clone(),
        author: "Wisper export".into(),
        update_url: profile.update_url.clone(),
        entries,
    };
    serde_json::to_string_pretty(&file).map_err(|e| e.to_string())
}

/// Returns the profile JSON text; the frontend saves it via Blob download.
#[tauri::command]
pub fn export_profile(profile_id: String) -> Result<String, String> {
    let profiles = list_imported_profiles()?;
    let pid = profile_id.trim();
    let profile = profiles
        .iter()
        .find(|p| p.id == pid)
        .ok_or_else(|| "Profile not found".to_string())?;
    build_export(profile)
}

/// Exports all user-added rows (`profile_id IS NULL`) as a shareable file.
#[tauri::command]
pub fn export_user_words() -> Result<String, String> {
    let conn = crate::words::WordsManager::conn();
    let mut stmt = conn
        .prepare(
            "SELECT phrase, variants, case_sensitive, whole_word FROM words
             WHERE profile_id IS NULL ORDER BY LOWER(phrase)",
        )
        .map_err(|e| e.to_string())?;
    let entries = stmt
        .query_map([], |row| {
            Ok(ProfileEntryInput {
                phrase: row.get(0)?,
                variants: row.get(1)?,
                case_sensitive: row.get::<_, i64>(2)? != 0,
                whole_word: row.get::<_, i64>(3)? != 0,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    if entries.is_empty() {
        return Err("No custom words to export".into());
    }
    let file = ProfileFile {
        id: "wisper-user-export".into(),
        name: "My words".into(),
        description: "Exported from Wisper".into(),
        version: String::new(),
        author: "Wisper export".into(),
        update_url: String::new(),
        entries,
    };
    serde_json::to_string_pretty(&file).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn check_profile_updates() -> Result<Vec<ProfileUpdate>, String> {
    let profiles = list_imported_profiles()?;
    let with_url: Vec<ProfileMeta> = profiles
        .into_iter()
        .filter(|p| !p.update_url.trim().is_empty())
        .collect();
    if with_url.is_empty() {
        return Ok(Vec::new());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for p in with_url {
            let text = match client.get(p.update_url.trim()).send() {
                Ok(r) => match r.text() {
                    Ok(t) => t,
                    Err(_) => continue,
                },
                Err(_) => continue,
            };
            let remote: ProfileFile = match serde_json::from_str(&text) {
                Ok(f) => f,
                Err(_) => continue,
            };
            if remote.id != p.id {
                continue;
            }
            if !remote.version.trim().is_empty() && remote.version.trim() != p.version.trim() {
                out.push(ProfileUpdate {
                    profile_id: p.id.clone(),
                    name: p.name.clone(),
                    current_version: p.version.clone(),
                    latest_version: remote.version,
                    url: p.update_url.clone(),
                });
            }
        }
        Ok(out)
    })
    .await
    .map_err(|_| "Update check failed unexpectedly".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_id(tag: &str) -> String {
        format!("__test_profile_{tag}__")
    }

    fn cleanup(id: &str) {
        let conn = crate::words::WordsManager::conn();
        let _ = conn.execute("DELETE FROM words WHERE profile_id = ?1", params![id]);
        let _ = conn.execute("DELETE FROM dictionary_profiles WHERE id = ?1", params![id]);
        crate::words::clear_words_regex_cache();
    }

    fn sample_json(id: &str) -> String {
        serde_json::json!({
            "id": id,
            "name": format!("Test {id}"),
            "description": "unit test profile",
            "version": "2024-01-01",
            "author": "test",
            "entries": [
                {"phrase": format!("KuberTest{0}", id.len()), "variants": "kuber test phrase", "caseSensitive": false, "wholeWord": true},
                {"phrase": "TestPhraseTwo", "variants": ["test phrase 2", "tee pee two"], "caseSensitive": false, "wholeWord": true}
            ]
        })
        .to_string()
    }

    #[test]
    fn import_is_idempotent() {
        let id = test_id("idempotent");
        cleanup(&id);
        let raw = sample_json(&id);
        let r1 = import_profile_text(&raw, "imported").expect("first import");
        assert_eq!(r1.added, 2, "first import adds all");
        let r2 = import_profile_text(&raw, "imported").expect("second import");
        assert_eq!(r2.added, 0, "re-import adds nothing");
        assert_eq!(r2.unchanged, 2, "re-import all unchanged");
        cleanup(&id);
    }

    #[test]
    fn toggle_skips_and_restores_entries() {
        let id = test_id("toggle");
        cleanup(&id);
        // Unique phrase unlikely to collide with a real user DB.
        // Use multi-char variant to avoid colliding with single-letter
        // entries in bundled profiles (e.g. "X" -> "x").
        let phrase = "ZxqToggleWisp";
        let variant = "zxq toggle wisp";
        let raw = serde_json::json!({
            "id": id, "name": "toggle", "version": "1",
            "entries": [{"phrase": phrase, "variants": variant, "wholeWord": true}]
        })
        .to_string();
        import_profile_text(&raw, "imported").expect("import");
        assert_eq!(
            crate::words::apply_words(&format!("say {variant} now")),
            format!("say {phrase} now")
        );
        set_profile_active(id.clone(), false).expect("deactivate");
        assert_eq!(
            crate::words::apply_words(&format!("say {variant} now")),
            format!("say {variant} now"),
            "inactive profile must not apply"
        );
        set_profile_active(id.clone(), true).expect("reactivate");
        assert_eq!(
            crate::words::apply_words(&format!("say {variant} now")),
            format!("say {phrase} now")
        );
        cleanup(&id);
    }

    #[test]
    fn remove_keeps_user_edited_rows() {
        let id = test_id("remove");
        cleanup(&id);
        let phrase = "ZxqKeepWisp";
        let raw = serde_json::json!({
            "id": id, "name": "remove", "version": "1",
            "entries": [{"phrase": phrase, "variants": "z x q keep wisp", "wholeWord": true}]
        })
        .to_string();
        import_profile_text(&raw, "imported").expect("import");
        // Simulate user edit -> detaches the row.
        let row_id: i64 = crate::words::WordsManager::conn()
            .query_row(
                "SELECT id FROM words WHERE LOWER(phrase) = LOWER(?1)",
                params![phrase],
                |r| r.get(0),
            )
            .expect("row exists");
        crate::words::WordsManager::new()
            .update(row_id, phrase, "z x q keep wisp, custom variant", false, true)
            .expect("edit");
        let deleted = remove_profile(id.clone()).expect("remove");
        assert_eq!(deleted, 0, "edited row was detached, nothing owned left");
        let still_there: i64 = crate::words::WordsManager::conn()
            .query_row(
                "SELECT COUNT(*) FROM words WHERE LOWER(phrase) = LOWER(?1)",
                params![phrase],
                |r| r.get(0),
            )
            .unwrap_or(0);
        assert_eq!(still_there, 1, "user-edited row survives profile removal");
        // Test cleanup.
        let _ = crate::words::WordsManager::new().delete(row_id);
        cleanup(&id);
    }

    #[test]
    fn rejects_bad_json() {
        assert!(import_profile_text("not json", "imported").is_err());
        assert!(import_profile_text(r#"{"id":"","name":"x","entries":[]}"#, "imported").is_err());
        assert!(import_profile_text(
            r#"{"id":"a","name":"b","entries":[{"phrase":"","variants":"x"}]}"#,
            "imported"
        )
        .is_err());
    }

    #[test]
    fn bundled_profiles_parse() {
        for raw in bundled_jsons() {
            let pf: ProfileFile = serde_json::from_str(raw).expect("bundled must parse");
            assert!(!pf.id.is_empty());
            assert!(!pf.name.is_empty());
            assert!(!pf.entries.is_empty(), "profile {} is empty", pf.id);
        }
    }
}
