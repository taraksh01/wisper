import { useRef, useEffect } from "react";
import { HistoryEntry } from "../types";
import { IconCopy, IconEdit, IconTrash, IconPlay, IconStop, IconRetry } from "./ui/icons";

interface HistoryItemProps {
  entry: HistoryEntry;
  selected: boolean;
  playing: boolean;
  retranscribing: boolean;
  copied: boolean;
  editing: boolean;
  editRaw: string;
  editFormatted: string;
  onToggleSelect: (id: number) => void;
  onTogglePlay: (id: number, path: string) => void;
  onRetranscribe: (entry: HistoryEntry) => void;
  onCopy: (entry: HistoryEntry) => void;
  onStartEdit: (entry: HistoryEntry) => void;
  onCancelEdit: () => void;
  onSaveEdit: (id: number) => void;
  onDelete: (id: number) => void;
  onEditRawChange: (v: string) => void;
  onEditFormattedChange: (v: string) => void;
}

export function HistoryItem({
  entry,
  selected,
  playing,
  retranscribing,
  copied,
  editing,
  editRaw,
  editFormatted,
  onToggleSelect,
  onTogglePlay,
  onRetranscribe,
  onCopy,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  onEditRawChange,
  onEditFormattedChange,
}: HistoryItemProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) inputRef.current.focus();
  }, [editing]);

  if (editing) {
    return (
      <div className="rounded-md px-2.5 py-2 bg-accent/8 border-l-2 border-accent">
        <div className="space-y-2">
          <textarea
            ref={inputRef}
            value={editRaw}
            onChange={(e) => onEditRawChange(e.target.value)}
            className="w-full bg-base rounded px-2 py-1 text-xs font-mono text-ink outline-none ring-1 ring-stroke focus:ring-accent/40 resize-none"
            rows={2}
          />
          <textarea
            value={editFormatted}
            onChange={(e) => onEditFormattedChange(e.target.value)}
            placeholder="Formatted (optional)"
            className="w-full bg-base rounded px-2 py-1 text-xs font-mono text-ink outline-none ring-1 ring-stroke focus:ring-accent/40 resize-none"
            rows={2}
          />
          <div className="flex gap-1.5">
            <button
              onClick={() => onSaveEdit(entry.id)}
              className="text-[11px] font-mono text-ready hover:text-green-400 transition-colors"
            >
              Save
            </button>
            <button
              onClick={onCancelEdit}
              className="text-[11px] font-mono text-muted hover:text-ink transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`rounded-md px-2.5 py-2 transition-colors ${
        selected ? "bg-accent/8 border-l-2 border-accent" : "bg-elevated/30 hover:bg-elevated/60"
      }`}
    >
      <div className="flex items-center justify-between mb-0.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelect(entry.id)}
            className="w-3 h-3 accent-accent shrink-0"
            aria-label={`Select entry from ${entry.created_at}`}
          />
          {entry.recording_path && (
            <button
              onClick={() => onTogglePlay(entry.id, entry.recording_path!)}
              className="shrink-0 p-1 text-muted hover:text-accent rounded transition-colors"
              title={playing ? "Stop" : "Play recording"}
            >
              {playing ? <IconStop className="w-3.5 h-3.5" /> : <IconPlay className="w-3.5 h-3.5" />}
            </button>
          )}
          <span className="text-[10px] font-mono text-muted truncate">{entry.created_at}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {entry.recording_path && (
            <button
              onClick={() => onRetranscribe(entry)}
              className="p-1 text-muted hover:text-accent rounded transition-colors"
              title="Re-transcribe"
              disabled={retranscribing}
            >
              {retranscribing ? (
                <span className="text-[10px] font-mono text-accent">...</span>
              ) : (
                <IconRetry className="w-3.5 h-3.5" />
              )}
            </button>
          )}
          <button
            onClick={() => onCopy(entry)}
            className="p-1 text-muted hover:text-accent rounded transition-colors"
            title="Copy"
          >
            {copied ? <span className="text-[10px] font-mono text-ready">Copied</span> : <IconCopy className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={() => onStartEdit(entry)}
            className="p-1 text-muted hover:text-warning rounded transition-colors"
            title="Edit"
          >
            <IconEdit className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onDelete(entry.id)}
            className="p-1 text-muted hover:text-recording rounded transition-colors"
            title="Delete"
          >
            <IconTrash className="w-3.5 h-3.5" />
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
    </div>
  );
}
