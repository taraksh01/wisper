import { useRef, useEffect } from "react";
import { HistoryEntry } from "../types";

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
              {playing ? <StopIcon /> : <PlayIcon />}
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
                <RetryIcon />
              )}
            </button>
          )}
          <button
            onClick={() => onCopy(entry)}
            className="p-1 text-muted hover:text-accent rounded transition-colors"
            title="Copy"
          >
            {copied ? <span className="text-[10px] font-mono text-ready">Copied</span> : <CopyIcon />}
          </button>
          <button
            onClick={() => onStartEdit(entry)}
            className="p-1 text-muted hover:text-warning rounded transition-colors"
            title="Edit"
          >
            <EditIcon />
          </button>
          <button
            onClick={() => onDelete(entry.id)}
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
    </div>
  );
}
