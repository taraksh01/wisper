import { useState, useCallback, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { HistoryEntry, AppSettings } from "../types";
import { SectionCard } from "./SectionCard";
import { Switch } from "./Switch";
import { ConfirmModal } from "./ConfirmModal";
import { HistoryItem } from "./HistoryItem";
import { useToast } from "./ToastContext";

interface HistoryTabProps {
  history: HistoryEntry[];
  stats: [number, number, number];
  settings: AppSettings;
  onSave: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  onRefresh: () => void;
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
  const [query, setQuery] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Time saved is accumulated in settings by the backend on each dictation.
  const timeSavedSec = settings.time_saved_sec;

  const filteredHistory = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return history;
    return history.filter((e) => {
      const text = (e.formatted_text || e.raw_text).toLowerCase();
      return text.includes(q) || (e.agent_name?.toLowerCase().includes(q) ?? false);
    });
  }, [history, query]);

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
    addToast("Re-transcribing…", "info", 1500);
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
    <div className="h-full max-w-5xl mx-auto flex flex-col space-y-4 card-enter">
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
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: "Dictations", value: stats[0] },
            { label: "Words", value: stats[1] },
            { label: "Avg Words", value: stats[2].toFixed(1) },
            {
              label: "Time Saved @60wpm",
              value: timeSavedSec >= 3600
                ? `${Math.floor(timeSavedSec / 3600)}h ${Math.floor((timeSavedSec % 3600) / 60)}m`
                : timeSavedSec >= 60
                ? `${Math.floor(timeSavedSec / 60)}m ${timeSavedSec % 60}s`
                : `${timeSavedSec}s`,
            },
          ].map((s) => (
            <div
              key={s.label}
              title={s.label === "Time Saved" ? "Estimated at 60 WPM typing speed" : undefined}
              className="bg-elevated/30 rounded-lg px-2 py-2.5 text-center min-w-0"
            >
              <div className="text-lg font-bold font-mono text-accent tabular-nums truncate">{s.value}</div>
              <div className="text-[9px] sm:text-[10px] font-mono text-muted mt-0.5 tracking-wider uppercase truncate">{s.label}</div>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard className="card-enter flex-1 min-h-0 flex flex-col">
        <div className="flex items-center gap-3 mb-3">
          <h2 className="text-[10px] font-mono text-muted tracking-[0.12em] uppercase shrink-0">Recent</h2>
          <div className="relative flex-1 min-w-0">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted/50 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <circle cx="11" cy="11" r="7" />
              <path strokeLinecap="round" strokeLinejoin="round" d="m20 20-4.35-4.35" />
            </svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search history…"
              className="w-full bg-elevated/50 rounded-md pl-8 pr-3 py-1.5 text-xs font-mono text-ink placeholder:text-muted/50 outline-none ring-1 ring-stroke focus:ring-accent/40 transition-all"
            />
          </div>
          <div className="flex items-center gap-3 shrink-0">
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
              onClick={() => {
                onRefresh();
                addToast("History refreshed", "success");
              }}
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
            {selectedIds.size < filteredHistory.length && (
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

        {filteredHistory.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center py-12 px-4">
            <div className="w-12 h-12 rounded-2xl bg-elevated/60 ring-1 ring-stroke flex items-center justify-center mb-3">
              <svg className="w-6 h-6 text-muted/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </div>
            {history.length === 0 ? (
              <>
                <p className="text-xs font-medium text-ink">No dictations yet</p>
                <p className="text-[11px] text-muted mt-1 leading-relaxed max-w-[240px]">
                  Press <span className="font-mono text-accent">{settings.hotkey}</span> and start speaking — your transcribed text will appear here.
                </p>
              </>
            ) : (
              <p className="text-xs font-medium text-ink">No matches for “{query}”</p>
            )}
          </div>
        ) : (
          <div className="max-h-[calc(100vh-18rem)] overflow-y-auto custom-scrollbar pr-0.5 space-y-1.5">
            {filteredHistory.map((entry) => (
              <HistoryItem
                key={entry.id}
                entry={entry}
                selected={selectedIds.has(entry.id)}
                playing={playingId === entry.id}
                retranscribing={retranscribingId === entry.id}
                copied={copiedId === entry.id}
                editing={editingId === entry.id}
                editRaw={editRaw}
                editFormatted={editFormatted}
                onToggleSelect={toggleSelect}
                onTogglePlay={togglePlay}
                onRetranscribe={retranscribe}
                onCopy={copyEntry}
                onStartEdit={startEdit}
                onCancelEdit={cancelEdit}
                onSaveEdit={saveEdit}
                onDelete={deleteEntry}
                onEditRawChange={setEditRaw}
                onEditFormattedChange={setEditFormatted}
              />
            ))}
          </div>
        )}
      </SectionCard>

      {showClearConfirm && (
        <ConfirmModal
          title="Clear all history?"
          message="This will permanently delete all dictations and recordings."
          confirmLabel="Clear all"
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
