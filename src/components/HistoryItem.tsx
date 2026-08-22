import { useRef, useEffect } from "react";
import { HistoryEntry } from "../types";
import { IconCopy, IconEdit, IconTrash, IconPlay, IconStop, IconRetry } from "./ui/icons";

/** SQLite stores UTC ("YYYY-MM-DD HH:MM:SS"); show it as a human date in local time. */
function formatTimestamp(stored: string): string {
  const iso = stored.includes("T") ? stored : `${stored.replace(" ", "T")}Z`;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return stored;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

interface HistoryItemProps {
  entry: HistoryEntry;
  selected: boolean;
  playerOpen: boolean;
  retranscribing: boolean;
  copied: boolean;
  editing: boolean;
  editRaw: string;
  editFormatted: string;
  onToggleSelect: (id: number) => void;
  onTogglePlay: (id: number, path: string, rect: { top: number; bottom: number; left: number; width: number; height: number }) => void;
  onRetranscribe: (entry: HistoryEntry) => void;
  onCopy: (entry: HistoryEntry) => void;
  onStartEdit: (entry: HistoryEntry) => void;
  onCancelEdit: () => void;
  onSaveEdit: (id: number) => void;
  onDelete: (id: number) => void;
  onEditRawChange: (v: string) => void;
  onEditFormattedChange: (v: string) => void;
}

/** White check drawn as background so appearance:none checkboxes stay engine-proof. */
const CHECK_SVG =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M5 13l4 4L19 7'/%3E%3C/svg%3E";

export function HistoryItem({
  entry,
  selected,
  playerOpen,
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
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) inputRef.current.focus();
  }, [editing]);

  if (editing) {
    return (
      <div className="rounded-xl px-3 py-2.5 bg-accent/8">
        <div className="space-y-2">
          <textarea
            ref={inputRef}
            value={editRaw}
            onChange={(e) => onEditRawChange(e.target.value)}
            className="w-full bg-base rounded-lg px-2 py-1.5 text-xs font-mono text-ink outline-none ring-1 ring-stroke focus:ring-accent/40 resize-none"
            rows={2}
          />
          <textarea
            value={editFormatted}
            onChange={(e) => onEditFormattedChange(e.target.value)}
            placeholder="Formatted (optional)"
            className="w-full bg-base rounded-lg px-2 py-1.5 text-xs font-mono text-ink outline-none ring-1 ring-stroke focus:ring-accent/40 resize-none"
            rows={2}
          />
          <div className="flex gap-3">
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
      ref={rowRef}
      className={`group relative rounded-xl px-2.5 py-2 transition-colors ${
        selected ? "bg-accent/10" : "bg-elevated/30 hover:bg-elevated/60"
      }`}
    >
      <div className="flex items-center gap-1 mb-1">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(entry.id)}
          className={`w-3.5 h-3.5 shrink-0 appearance-none cursor-pointer rounded-[5px] border transition-all duration-150 ${
            selected
              ? "opacity-100 border-accent bg-accent"
              : "border-stroke bg-surface shadow-[inset_0_1px_2px_rgba(0,0,0,0.25)] hover:border-muted opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          }`}
          style={
            selected
              ? {
                  backgroundImage: `url("${CHECK_SVG}")`,
                  backgroundSize: "75%",
                  backgroundPosition: "center",
                  backgroundRepeat: "no-repeat",
                }
              : undefined
          }
          aria-label={`Select entry from ${entry.created_at}`}
        />
        {entry.recording_path && (
          <button
            onClick={() => {
              const r = rowRef.current?.getBoundingClientRect();
              if (r) onTogglePlay(entry.id, entry.recording_path!, {
                top: r.top, bottom: r.bottom, left: r.left, width: r.width, height: r.height,
              });
            }}
            className={`shrink-0 p-1 rounded transition-colors ${
              playerOpen ? "text-accent" : "text-muted hover:text-accent"
            }`}
            title={playerOpen ? "Close player" : "Play recording"}
          >
            {playerOpen ? <IconStop className="w-3.5 h-3.5" /> : <IconPlay className="w-3.5 h-3.5" />}
          </button>
        )}
        <span className="text-[10px] font-mono text-muted truncate" title={new Date(entry.created_at.replace(" ", "T") + (entry.created_at.includes("Z") || entry.created_at.includes("T") ? "" : "Z")).toLocaleString()}>
          {formatTimestamp(entry.created_at)}
        </span>
        <span className="shrink-0 text-[9px] font-mono text-muted/70 tabular-nums px-1.5 py-0.5 rounded-md bg-base/50 ring-1 ring-stroke/60">
          {entry.word_count} {entry.word_count === 1 ? "word" : "words"}
        </span>

        <span className="ml-auto shrink-0 flex items-center gap-1">
          <span className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
            {entry.recording_path && (
              <button
                onClick={() => onRetranscribe(entry)}
                className="p-1 text-muted hover:text-accent rounded transition-colors"
                title="Re-transcribe"
                disabled={retranscribing}
              >
                {retranscribing ? (
                  <IconRetry className="w-3.5 h-3.5 text-accent animate-spin" />
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
              {copied ? (
                <svg className="w-3.5 h-3.5 text-ready" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <IconCopy className="w-3.5 h-3.5" />
              )}
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
          </span>
        </span>
      </div>
      <p className="text-xs text-ink leading-relaxed line-clamp-3 pl-[22px]" title={entry.formatted_text || entry.raw_text}>
        {entry.formatted_text || entry.raw_text}
      </p>
      {entry.agent_name && (
        <span className="inline-flex items-center gap-1 text-[9px] font-mono text-accent/80 mt-1 ml-[22px] px-1.5 py-0.5 rounded-md bg-accent/10 ring-1 ring-accent/20">
          <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2l2.1 5.9L20 10l-5.9 2.1L12 18l-2.1-5.9L4 10l5.9-2.1L12 2z" />
          </svg>
          {entry.agent_name}
        </span>
      )}
    </div>
  );
}
