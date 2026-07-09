import { useState, useRef, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { HistoryEntry, AppSettings } from "../types";

interface HistoryTabProps {
  history: HistoryEntry[];
  stats: [number, number, number];
  settings: AppSettings;
  onSave: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  onRefresh: () => void;
}

export function HistoryTab({ history, stats, settings, onSave, onRefresh }: HistoryTabProps) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editRaw, setEditRaw] = useState("");
  const [editFormatted, setEditFormatted] = useState("");
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editingId !== null && inputRef.current) {
      inputRef.current.focus();
    }
  }, [editingId]);

  const startEdit = useCallback((entry: HistoryEntry) => {
    setEditingId(entry.id);
    setEditRaw(entry.raw_text);
    setEditFormatted(entry.formatted_text || "");
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
  }, []);

  const saveEdit = useCallback(async (id: number) => {
    try {
      await invoke("update_history_entry", {
        id,
        rawText: editRaw,
        formattedText: editFormatted || null,
      });
      setEditingId(null);
      onRefresh();
    } catch (e) {
      console.error("Failed to update:", e);
    }
  }, [editRaw, editFormatted, onRefresh]);

  const deleteEntry = useCallback(async (id: number) => {
    try {
      await invoke("delete_history_entry", { id });
      onRefresh();
    } catch (e) {
      console.error("Failed to delete:", e);
    }
  }, [onRefresh]);

  const copyEntry = useCallback(async (entry: HistoryEntry) => {
    const text = entry.formatted_text || entry.raw_text;
    await navigator.clipboard.writeText(text);
    setCopiedId(entry.id);
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  return (
    <div className="space-y-3 panel-enter">
      <section className="panel-enter">
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "Dictations", value: stats[0] },
            { label: "Words", value: stats[1] },
            { label: "Avg Words", value: stats[2].toFixed(1) },
          ].map((s) => (
            <div key={s.label} className="bg-elevated/30 rounded-lg px-3 py-2.5 text-center">
              <div className="text-lg font-bold font-mono text-accent tabular-nums">{s.value}</div>
              <div className="text-[10px] font-mono text-muted mt-0.5 tracking-wider uppercase">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="panel-enter">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs font-mono text-muted tracking-wider uppercase">Recent</div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-[11px] font-mono text-muted cursor-pointer">
              <input
                type="checkbox"
                checked={settings.keep_recordings}
                onChange={(e) => onSave("keep_recordings", e.target.checked)}
                className="w-3 h-3 accent-accent"
              />
              Keep recordings
            </label>
            <button
              onClick={onRefresh}
              className="text-[11px] font-mono text-accent hover:text-accent-dim transition-colors"
            >
              Refresh
            </button>
          </div>
        </div>
        {history.length === 0 ? (
          <p className="text-xs text-muted">No history yet. Press {settings.hotkey} to dictate.</p>
        ) : (
          <div className="space-y-1.5 max-h-96 overflow-y-auto custom-scrollbar">
            {history.map((entry) => (
              <div
                key={entry.id}
                className="bg-elevated/30 rounded-md px-2.5 py-2 hover:bg-elevated/60 transition-colors group"
              >
                {editingId === entry.id ? (
                  <div className="space-y-2">
                    <textarea
                      ref={inputRef}
                      value={editRaw}
                      onChange={(e) => setEditRaw(e.target.value)}
                      className="w-full bg-base rounded px-2 py-1 text-xs font-mono text-ink outline-none ring-1 ring-stroke focus:ring-accent/40 resize-none"
                      rows={2}
                    />
                    <textarea
                      value={editFormatted}
                      onChange={(e) => setEditFormatted(e.target.value)}
                      placeholder="Formatted (optional)"
                      className="w-full bg-base rounded px-2 py-1 text-xs font-mono text-ink outline-none ring-1 ring-stroke focus:ring-accent/40 resize-none"
                      rows={2}
                    />
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => saveEdit(entry.id)}
                        className="text-[11px] font-mono text-ready hover:text-green-400 transition-colors"
                      >
                        Save
                      </button>
                      <button
                        onClick={cancelEdit}
                        className="text-[11px] font-mono text-muted hover:text-ink transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between mb-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono text-muted">{entry.created_at}</span>
                        {entry.recording_path && (
                          <span className="text-[9px] font-mono text-accent/60" title="Recording saved">&#9679;</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono text-muted tabular-nums">{entry.word_count}</span>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => copyEntry(entry)}
                            className="text-[11px] font-mono text-muted hover:text-accent transition-colors"
                            title="Copy"
                          >
                            {copiedId === entry.id ? "Copied!" : "Copy"}
                          </button>
                          <button
                            onClick={() => startEdit(entry)}
                            className="text-[11px] font-mono text-muted hover:text-warning transition-colors"
                            title="Edit"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => deleteEntry(entry.id)}
                            className="text-[11px] font-mono text-muted hover:text-recording transition-colors"
                            title="Delete"
                          >
                            Del
                          </button>
                        </div>
                      </div>
                    </div>
                    <p className="text-xs text-ink leading-relaxed line-clamp-3" title={entry.formatted_text || entry.raw_text}>
                      {entry.formatted_text || entry.raw_text}
                    </p>
                    {entry.agent_name && (
                      <span className="text-[10px] text-accent/70 mt-0.5 block">{entry.agent_name}</span>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
