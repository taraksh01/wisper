import { useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { HistoryEntry, AppSettings } from "../types";
import { SectionCard } from "./SectionCard";
import { Switch } from "./Switch";
import { useToast } from "./ToastContext";

interface HistoryTabProps {
  history: HistoryEntry[];
  stats: [number, number, number];
  settings: AppSettings;
  onSave: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  onRefresh: () => void;
}

function CopyIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
    </svg>
  );
}

function DeleteIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
      <path d="M6 6h12v12H6z" />
    </svg>
  );
}

function RetryIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
    </svg>
  );
}

function ConfirmModal({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onCancel}>
      <div className="bg-surface border border-stroke rounded-xl p-5 max-w-xs w-full mx-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-bold font-mono text-ink mb-2">Clear all history?</h3>
        <p className="text-xs text-muted mb-4 leading-relaxed">This will permanently delete all dictations and recordings.</p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-xs font-mono text-muted hover:text-ink rounded-md ring-1 ring-stroke hover:ring-muted transition-all"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-3 py-1.5 text-xs font-mono text-white bg-recording rounded-md hover:bg-red-500 transition-all"
          >
            Clear all
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

const audioCache = new Map<string, string>();

export function HistoryTab({ history, stats, settings, onSave, onRefresh }: HistoryTabProps) {
  const { addToast } = useToast();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editRaw, setEditRaw] = useState("");
  const [editFormatted, setEditFormatted] = useState("");
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [playingId, setPlayingId] = useState<number | null>(null);
  const [retranscribingId, setRetranscribingId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

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
      addToast("Entry updated", "success");
    } catch (e) {
      console.error("Failed to update:", e);
      addToast("Failed to update entry", "error");
    }
  }, [editRaw, editFormatted, onRefresh, addToast]);

  const deleteEntry = useCallback(async (id: number) => {
    try {
      await invoke("delete_history_entry", { id });
      onRefresh();
      addToast("Entry deleted", "success");
    } catch (e) {
      console.error("Delete failed:", e);
      addToast("Failed to delete entry", "error");
    }
  }, [onRefresh, addToast]);

  const deleteSelected = useCallback(async () => {
    const ids = Array.from(selectedIds);
    try {
      await Promise.all(ids.map((id) => invoke("delete_history_entry", { id })));
      setSelectedIds(new Set());
      onRefresh();
      addToast(`${ids.length} entries deleted`, "success");
    } catch (e) {
      console.error("Delete selected failed:", e);
      addToast("Failed to delete entries", "error");
    }
  }, [selectedIds, onRefresh, addToast]);

  const toggleSelect = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const copyEntry = useCallback(async (entry: HistoryEntry) => {
    const text = entry.formatted_text || entry.raw_text;
    await navigator.clipboard.writeText(text);
    setCopiedId(entry.id);
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  const togglePlay = useCallback(async (id: number, path: string) => {
    if (playingId === id) {
      audioRef.current?.pause();
      setPlayingId(null);
      return;
    }

    audioRef.current?.pause();

    try {
      let blobUrl = audioCache.get(path);
      if (!blobUrl) {
        const data = await invoke<number[]>("get_recording_data", { recordingPath: path });
        const bytes = new Uint8Array(data);
        const blob = new Blob([bytes], { type: "audio/wav" });
        blobUrl = URL.createObjectURL(blob);
        audioCache.set(path, blobUrl);
      }

      const audio = new Audio(blobUrl);
      audio.onended = () => setPlayingId(null);
      audio.onerror = () => setPlayingId(null);
      await audio.play();
      audioRef.current = audio;
      setPlayingId(id);
    } catch (e) {
      console.error("Playback failed:", e);
      addToast("Playback failed", "error");
    }
  }, [playingId, addToast]);

  const retranscribe = useCallback(async (entry: HistoryEntry) => {
    if (!entry.recording_path) return;
    setRetranscribingId(entry.id);
    try {
      const text = await invoke<string>("retranscribe_recording", {
        recordingPath: entry.recording_path,
      });
      await invoke("update_history_entry", {
        id: entry.id,
        rawText: text,
        formattedText: entry.formatted_text || null,
      });
      onRefresh();
      addToast("Retranscribed", "success");
    } catch (e) {
      console.error("Retranscribe failed:", e);
      addToast("Retranscribe failed", "error");
    }
    setRetranscribingId(null);
  }, [onRefresh, addToast]);

  return (
    <div className="max-w-lg space-y-4 card-enter">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          <h1 className="text-sm font-semibold text-ink tracking-tight">History</h1>
        </div>
      </div>

      <SectionCard className="card-enter">
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
      </SectionCard>

      <SectionCard className="card-enter">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[10px] font-mono text-muted tracking-[0.12em] uppercase">Recent</h2>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-[11px] font-mono text-muted">
              <span>Keep recordings</span>
              <Switch
                checked={settings.keep_recordings}
                onChange={(v) => onSave("keep_recordings", v)}
              />
            </div>
            {history.length > 0 && (
              <button
                onClick={() => setShowClearConfirm(true)}
                className="text-[11px] font-mono text-recording/70 hover:text-recording transition-colors"
              >
                Clear all
              </button>
            )}
            <button
              onClick={onRefresh}
              className="text-[11px] font-mono text-accent hover:text-accent-dim transition-colors"
            >
              Refresh
            </button>
          </div>
        </div>

        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2 mb-2 px-1">
            <button
              onClick={() => setSelectedIds(new Set())}
              className="text-[11px] font-mono text-muted hover:text-ink transition-colors"
            >
              Clear selection
            </button>
            <span className="text-[10px] font-mono text-muted tabular-nums">{selectedIds.size} selected</span>
            {selectedIds.size < history.length && (
              <button
                onClick={() => setSelectedIds(new Set(history.map((e) => e.id)))}
                className="text-[11px] font-mono text-accent/70 hover:text-accent transition-colors"
              >
                Select all
              </button>
            )}
            <button
              onClick={deleteSelected}
              className="ml-auto text-[11px] font-mono text-recording/70 hover:text-recording transition-colors"
            >
              Delete selected
            </button>
          </div>
        )}

        {history.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center py-10 px-4">
            <div className="w-12 h-12 rounded-2xl bg-elevated/60 ring-1 ring-stroke flex items-center justify-center mb-3">
              <svg className="w-6 h-6 text-muted/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </div>
            <p className="text-xs font-medium text-ink">No dictations yet</p>
            <p className="text-[11px] text-muted mt-1 leading-relaxed max-w-[240px]">
              Press <span className="font-mono text-accent">{settings.hotkey}</span> and start speaking — your transcribed text will appear here.
            </p>
          </div>
        ) : (
          <div className="space-y-1.5 max-h-96 overflow-y-auto custom-scrollbar">
            {history.map((entry) => (
              <div
                key={entry.id}
                className={`rounded-md px-2.5 py-2 transition-colors ${
                  selectedIds.has(entry.id)
                    ? "bg-accent/8 border-l-2 border-accent"
                    : "bg-elevated/30 hover:bg-elevated/60"
                }`}
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
                      <div className="flex items-center gap-1.5 min-w-0">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(entry.id)}
                          onChange={() => toggleSelect(entry.id)}
                          className="w-3 h-3 accent-accent shrink-0"
                        />
                        {entry.recording_path && (
                          <button
                            onClick={() => togglePlay(entry.id, entry.recording_path!)}
                            className="shrink-0 p-1 text-muted hover:text-accent rounded transition-colors"
                            title={playingId === entry.id ? "Stop" : "Play recording"}
                          >
                            {playingId === entry.id ? <StopIcon /> : <PlayIcon />}
                          </button>
                        )}
                        <span className="text-[10px] font-mono text-muted truncate">{entry.created_at}</span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {entry.recording_path && (
                          <button
                            onClick={() => retranscribe(entry)}
                            className="p-1 text-muted hover:text-accent rounded transition-colors"
                            title="Re-transcribe"
                            disabled={retranscribingId === entry.id}
                          >
                            {retranscribingId === entry.id ? (
                              <span className="text-[10px] font-mono text-accent">...</span>
                            ) : (
                              <RetryIcon />
                            )}
                          </button>
                        )}
                        <button
                          onClick={() => copyEntry(entry)}
                          className="p-1 text-muted hover:text-accent rounded transition-colors"
                          title="Copy"
                        >
                          {copiedId === entry.id ? (
                            <span className="text-[10px] font-mono text-ready">Copied</span>
                          ) : (
                            <CopyIcon />
                          )}
                        </button>
                        <button
                          onClick={() => startEdit(entry)}
                          className="p-1 text-muted hover:text-warning rounded transition-colors"
                          title="Edit"
                        >
                          <EditIcon />
                        </button>
                        <button
                          onClick={() => deleteEntry(entry.id)}
                          className="p-1 text-muted hover:text-recording rounded transition-colors"
                          title="Delete"
                        >
                          <DeleteIcon />
                        </button>
                        <span className="ml-1 text-[10px] font-mono text-muted tabular-nums">{entry.word_count}</span>
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
      </SectionCard>

      {showClearConfirm && (
        <ConfirmModal
          onConfirm={async () => {
            setShowClearConfirm(false);
            try {
              await invoke("clear_history");
              onRefresh();
              addToast("History cleared", "success");
            } catch (e) {
              console.error("Failed to clear history:", e);
              addToast("Failed to clear history", "error");
            }
          }}
          onCancel={() => setShowClearConfirm(false)}
        />
      )}
    </div>
  );
}
