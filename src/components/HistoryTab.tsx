import { IconHistory, IconSearch, IconRetry } from "./ui/icons";
import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { HistoryEntry, AppSettings } from "../types";
import { storageKey } from "../appConfig";
import { SectionCard } from "./SectionCard";
import { Switch } from "./Switch";
import { ConfirmModal } from "./ConfirmModal";
import { HistoryItem } from "./HistoryItem";
import { AudioPlayerPopover } from "./AudioPlayerPopover";
import { Input } from "./ui/Input";
import { useToast } from "./ToastContext";
import { useWindowSize } from "../hooks/useWindowSize";

interface HistoryTabProps {
  history: HistoryEntry[];
  stats: [number, number, number];
  settings: AppSettings;
  /** Total entries stored in the DB — may exceed what's loaded so far. */
  historyTotal: number;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  onSave: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  onRefresh: () => void;
}

const audioCache = new Map<string, string>();
const peaksCache = new Map<string, Float32Array>();

/** Downsample channel 0 into peak amplitudes for the waveform. */
async function computePeaks(blobUrl: string): Promise<Float32Array | null> {
  try {
    const buf = await (await fetch(blobUrl)).arrayBuffer();
    const ctx = new AudioContext();
    const audio = await ctx.decodeAudioData(buf);
    const ch = audio.getChannelData(0);
    const buckets = 120;
    const size = Math.max(1, Math.floor(ch.length / buckets));
    const out = new Float32Array(buckets);
    for (let i = 0; i < buckets; i++) {
      let max = 0;
      const start = i * size;
      for (let j = 0; j < size; j++) {
        const v = Math.abs(ch[start + j] || 0);
        if (v > max) max = v;
      }
      out[i] = max;
    }
    void ctx.close();
    return out;
  } catch {
    return null;
  }
}

export function HistoryTab({ history, stats, settings, historyTotal, loadingOlder, onLoadOlder, onSave, onRefresh }: HistoryTabProps) {
  const { addToast } = useToast();
  const { width: winWidth } = useWindowSize();
  const statCols = winWidth < 880 ? "grid-cols-2" : "grid-cols-4";
  useEffect(() => {
    return () => {
      audioCache.forEach((url) => URL.revokeObjectURL(url));
      audioCache.clear();
    };
  }, []);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editRaw, setEditRaw] = useState("");
  const [editFormatted, setEditFormatted] = useState("");
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [retranscribingId, setRetranscribingId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [query, setQuery] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [player, setPlayer] = useState<{
    id: number;
    path: string;
    rect: { top: number; bottom: number; left: number; width: number; height: number };
  } | null>(null);
  const [playerPlaying, setPlayerPlaying] = useState(false);
  const [playerTime, setPlayerTime] = useState(0);
  const [playerDur, setPlayerDur] = useState(0);
  const [peaks, setPeaks] = useState<Float32Array | null>(null);

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
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(entry.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // clipboard may be blocked (e.g. insecure context); ignore
    }
  }, []);

  const closePlayer = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    setPlayer(null);
    setPlayerPlaying(false);
    setPlayerTime(0);
    setPlayerDur(0);
    setPeaks(null);
  }, []);

  /** Row play button: opens the popover (and starts playback), or closes it if already open. */
  const togglePlay = useCallback(async (id: number, path: string, rect: { top: number; bottom: number; left: number; width: number; height: number }) => {
    if (player?.id === id) {
      closePlayer();
      return;
    }
    audioRef.current?.pause();

    try {
      let blobUrl = audioCache.get(path);
      if (!blobUrl) {
        const data = await invoke<number[]>("get_recording_data", { recordingPath: path });
        const bytes = new Uint8Array(data);
        blobUrl = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
        audioCache.set(path, blobUrl);
      }

      const audio = new Audio(blobUrl);
      audio.ontimeupdate = () => setPlayerTime(audio.currentTime);
      audio.onloadedmetadata = () => setPlayerDur(audio.duration || 0);
      audio.onended = () => setPlayerPlaying(false);
      await audio.play();
      audioRef.current = audio;
      setPlayer({ id, path, rect });
      setPlayerPlaying(true);
      setPlayerTime(0);

      // Waveform peaks (cached per recording)
      const cached = peaksCache.get(path);
      if (cached) {
        setPeaks(cached);
      } else {
        setPeaks(null);
        computePeaks(blobUrl).then((p) => {
          if (p) peaksCache.set(path, p);
          setPeaks(p);
        });
      }
    } catch (e) {
      console.error("Playback failed:", e);
      addToast("Playback failed", "error");
    }
  }, [player, addToast, closePlayer]);

  const togglePlayPause = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      void a.play();
      setPlayerPlaying(true);
    } else {
      a.pause();
      setPlayerPlaying(false);
    }
  }, []);

  const seekTo = useCallback((fraction: number) => {
    const a = audioRef.current;
    if (!a || !isFinite(a.duration)) return;
    a.currentTime = fraction * a.duration;
    setPlayerTime(a.currentTime);
  }, []);

  // Playback speed — persisted so every recording (and session) reuses it
  const [playbackRate, setPlaybackRate] = useState(() => {
    const v = parseFloat(localStorage.getItem(storageKey("playbackRate")) || "");
    return Number.isFinite(v) && v > 0 ? v : 1;
  });

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = playbackRate;
    localStorage.setItem(storageKey("playbackRate"), String(playbackRate));
  }, [playbackRate]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = playbackRate;
  }, [player, playbackRate]);

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
    <div className="w-full flex flex-col space-y-4 card-enter min-h-0">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <IconHistory className="w-5 h-5 text-accent" />
          <h1 className="text-sm font-semibold text-ink tracking-tight">History</h1>
        </div>
      </div>

      <SectionCard className="card-enter">
        <div className={`grid ${statCols} gap-2`}>
          {[
            { label: "Dictations", value: String(stats[0]) },
            { label: "Words", value: String(stats[1]) },
            { label: "Avg Words", value: stats[2].toFixed(1) },
            {
              label: "Time saved",
              value: timeSavedSec >= 3600
                ? `${Math.floor(timeSavedSec / 3600)}h ${Math.floor((timeSavedSec % 3600) / 60)}m`
                : timeSavedSec >= 60
                ? `${Math.floor(timeSavedSec / 60)}m ${timeSavedSec % 60}s`
                : `${timeSavedSec}s`,
            },
          ].map((s) => (
            <div
              key={s.label}
              title={s.label === "Time saved" ? "Estimated at 60 WPM typing speed" : undefined}
              className="bg-elevated/40 rounded-xl px-3 py-3 text-center min-w-0"
            >
              <div className="text-xl font-bold font-mono text-accent tabular-nums truncate leading-none">{s.value}</div>
              <div className="text-[9px] font-mono text-muted mt-1.5 tracking-[0.12em] uppercase truncate">{s.label}</div>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard className="card-enter flex flex-col h-[457px]">
        <div className="flex items-center gap-3 mb-3">
          <h2 className="label-soft shrink-0">Recent</h2>
          <div className="relative flex-1 min-w-0">
            <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted pointer-events-none" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search history…"
              className="w-full pl-8 pr-3"
            />
          </div>
          <div
            className="flex items-center gap-2 shrink-0"
            title="Keep audio recordings for re-transcription"
          >
            <span className="text-[10px] font-mono text-muted whitespace-nowrap">Recordings</span>
            <Switch label="Keep recordings" checked={settings.keep_recordings}
              onChange={(v) => onSave("keep_recordings", v)}
            />
          </div>
          {history.length > 0 && (
            <button
              onClick={() => setShowClearConfirm(true)}
              className="shrink-0 p-1.5 rounded-md text-recording/60 hover:text-recording transition-colors"
              title="Clear all history"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z" />
              </svg>
            </button>
          )}
          <button
            onClick={() => {
              onRefresh();
              addToast("History refreshed", "success");
            }}
            className="shrink-0 p-1.5 rounded-md text-muted hover:text-accent transition-colors"
            title="Refresh"
          >
            <IconRetry className="w-3.5 h-3.5" />
          </button>
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
                onClick={() => setSelectedIds(new Set(filteredHistory.map((e) => e.id)))}
                className="text-[11px] font-mono text-accent/70 hover:text-accent transition-colors"
              >
                Select all filtered
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
          <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-0.5 space-y-1.5">
            {filteredHistory.map((entry) => (
              <HistoryItem
                key={entry.id}
                entry={entry}
                selected={selectedIds.has(entry.id)}
                playerOpen={player?.id === entry.id}
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

            {/* Pager: older entries beyond what's loaded */}
            {!query && history.length < historyTotal && (
              <button
                onClick={onLoadOlder}
                disabled={loadingOlder}
                className="w-full py-2 text-[11px] font-mono text-accent/80 hover:text-accent hover:bg-elevated/40 rounded-lg transition-colors"
              >
                {loadingOlder
                  ? "Loading…"
                  : `Load 50 older (${history.length} of ${historyTotal})`}
              </button>
            )}
          </div>
        )}
      </SectionCard>

      {player && (
        <AudioPlayerPopover
          peaks={peaks}
          playing={playerPlaying}
          time={playerTime}
          duration={playerDur}
          speed={playbackRate}
          onSpeedChange={setPlaybackRate}
          onToggle={togglePlayPause}
          onSeek={seekTo}
          onClose={closePlayer}
        />
      )}

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