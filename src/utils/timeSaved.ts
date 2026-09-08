/**
 * Time saved vs typing — single source of truth.
 * Mirrors `src-tauri/src/coordinator.rs:701-703` and `settings.rs:527`.
 * 60 WPM = 1 word per second.
 */
export function calcSavedSeconds(words: number, durationMs: number): number {
  const typing = words / 1.0;
  const speak = durationMs / 1000;
  return Math.max(0, Math.floor(typing - speak));
}

export function formatSaved(seconds: number): string {
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  if (seconds >= 60) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${seconds}s`;
}
