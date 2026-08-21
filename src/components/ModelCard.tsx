import { IconStack, IconClose, IconDownload, IconTrash, IconGlobe, IconWave, IconTranslate, IconLink } from "./ui/icons";
import { ModelInfo, formatModelFilename, languages } from "../types";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useState } from "react";
import { createPortal } from "react-dom";
import { useEffect } from "react";

interface ModelCardProps {
  modelKey: string;
  info: ModelInfo;
  isInstalled: boolean;
  isActive: boolean;
  isDownloading: boolean;
  progress?: number;
  speedBps?: number;
  downloaded?: number;
  total?: number;
  justDownloaded?: boolean;
  /** Downloaded Indic model missing tokens/vocab — shows repair button */
  missingAssets?: boolean;
  installingAssets?: boolean;
  onActivate: (filename: string) => void;
  onDownload: (modelKey: string) => void;
  onDelete: (filename: string) => void;
  onCancel: (modelKey: string) => void;
  onInstallAssets: (modelKey: string) => void;
}

function formatSpeed(bps?: number): string {
  if (!bps || bps <= 0) return "";
  if (bps > 1024 * 1024) return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
  if (bps > 1024) return `${(bps / 1024).toFixed(0)} KB/s`;
  return `${bps.toFixed(0)} B/s`;
}
function formatBytes(bytes?: number): string {
  if (!bytes) return "";
  if (bytes > 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes > 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

function ModelCard({
  modelKey,
  info,
  isInstalled,
  isActive,
  isDownloading,
  progress,
  speedBps,
  downloaded,
  total,
  justDownloaded,
  missingAssets = false,
  installingAssets = false,
  onActivate,
  onDownload,
  onDelete,
  onCancel,
  onInstallAssets,
}: ModelCardProps) {
  const filename = formatModelFilename(modelKey, info.format);
  const [showLangs, setShowLangs] = useState(false);
  const [langQuery, setLangQuery] = useState("");

  useEffect(() => {
    if (!showLangs) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") { setShowLangs(false); setLangQuery(""); } };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [showLangs]);

  const langLabel = (code: string) => languages.find((l) => l.value === code)?.label ?? code;
  const filteredLangs = langQuery
    ? info.languages.filter((c) => langLabel(c).toLowerCase().includes(langQuery.toLowerCase()))
    : info.languages;

  return (
    <>
      {showLangs && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => { setShowLangs(false); setLangQuery(""); }}
          role="dialog" aria-modal="true" aria-label={`${info.name} supported languages`}
        >
          <div
            className="bg-surface border border-stroke rounded-2xl shadow-[0_16px_48px_rgba(0,0,0,0.24)] w-full max-w-sm overflow-hidden"
            onClick={(e) => e.stopPropagation()}
            role="document"
          >
            <div className="px-5 pt-5 pb-4 border-b border-stroke">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">Supported languages</h3>
                  <p className="text-xs text-muted mt-1">{info.name} · {info.languages.length} {info.languages.length === 1 ? "language" : "languages"}</p>
                </div>
                <button
                  onClick={() => { setShowLangs(false); setLangQuery(""); }}
                  aria-label="Close"
                  className="shrink-0 w-7 h-7 grid place-items-center rounded-full bg-elevated border border-stroke text-muted hover:text-ink transition-colors"
                >
                  <IconClose className="w-3.5 h-3.5" />
                </button>
              </div>
              <input
                type="text"
                value={langQuery}
                onChange={(e) => setLangQuery(e.target.value)}
                placeholder="Search languages…"
                autoFocus
                className="mt-3 w-full bg-surface border border-stroke rounded-xl px-3.5 py-2.5 text-xs font-medium text-ink placeholder:text-muted/50 outline-none focus:border-accent/40 focus:ring-2 focus:ring-accent/15 shadow-[inset_0_1px_0_var(--color-stroke-soft)] transition-[border-color,box-shadow] duration-150"
              />
            </div>
            <div className="max-h-[280px] overflow-y-auto custom-scrollbar p-2">
              {filteredLangs.map((code) => (
                <div
                  key={code}
                  className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-elevated transition-colors"
                >
                  <span className="text-xs font-medium text-ink truncate">{langLabel(code)}</span>
                  <span className="text-[10px] font-mono text-muted uppercase">{code}</span>
                </div>
              ))}
              {filteredLangs.length === 0 && (
                <p className="px-3 py-6 text-center text-xs text-muted">No languages match “{langQuery}”</p>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
      <div
        role={isInstalled ? "button" : undefined}
        tabIndex={isInstalled ? 0 : undefined}
        aria-pressed={isInstalled ? isActive : undefined}
        onClick={() => { if (isInstalled) onActivate(filename); }}
        onKeyDown={(e) => {
          if (!isInstalled) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onActivate(filename);
          }
        }}
        className={`group rounded-xl border p-4 transition-all duration-150 ${isInstalled ? "cursor-pointer" : "cursor-default"} ${
          isActive
            ? "bg-accent-soft border-accent/20 shadow-sm"
            : "bg-surface border-stroke hover:border-accent/25 hover:shadow-sm"
        }`}
      >
        {/* Header — icon | name+badges | action */}
        <div className="flex items-start gap-3">
          <span className={`shrink-0 w-8 h-8 grid place-items-center rounded-lg border ${isActive ? "bg-accent border-accent text-white" : "bg-elevated border-stroke text-muted"}`}>
            <IconStack className="w-4 h-4" />
          </span>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[13px] font-medium text-ink tracking-[-0.01em]">{info.name}</span>
              {info.recommended && (
                <span className="text-[10px] font-medium tracking-widest uppercase bg-warning/15 text-warning border border-warning/20 px-1.5 py-0.5 rounded-full leading-none">Recommended</span>
              )}
              {isActive && <span className="text-[10px] font-medium px-2 py-1 rounded-full bg-accent text-white leading-none">Active</span>}
              {justDownloaded && <span className="text-[10px] font-medium px-2 py-1 rounded-full bg-ready/15 text-ready border border-ready/20 animate-pulse leading-none">New</span>}
            </div>
            <p className="text-[11px] font-mono text-muted mt-1">
              {info.size} · {info.quantization.toUpperCase()} · {info.runtime}
            </p>
          </div>

          <div className="shrink-0 ml-2">
            {!isInstalled ? (
              isDownloading ? (
                <button
                  onClick={(e) => { e.stopPropagation(); onCancel(modelKey); }}
                  className="w-7 h-7 grid place-items-center rounded-full bg-recording/10 border border-recording/20 text-recording hover:bg-recording/15 transition-colors"
                  title="Cancel download"
                >
                  <IconClose className="w-3.5 h-3.5" />
                </button>
              ) : (
                <button
                  onClick={(e) => { e.stopPropagation(); onDownload(modelKey); }}
                  className="w-7 h-7 grid place-items-center rounded-full bg-accent text-white shadow-sm hover:bg-accent-dim transition-colors"
                  title="Download model"
                >
                  <IconDownload className="w-3.5 h-3.5" />
                </button>
              )
            ) : (
              <div className="flex items-center gap-1.5">
                {missingAssets && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onInstallAssets(modelKey); }}
                    disabled={installingAssets}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-warning/15 border border-warning/25 text-warning hover:bg-warning/20 transition-colors text-[10px] font-medium disabled:opacity-50"
                    title="Download missing tokens/vocab so this model can transcribe"
                  >
                    {installingAssets ? (
                      <>
                        <span className="w-2.5 h-2.5 rounded-full border-[1.5px] border-warning border-t-transparent animate-spin" />
                        Installing…
                      </>
                    ) : (
                      "Install language data"
                    )}
                  </button>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(filename); }}
                  className="w-7 h-7 grid place-items-center rounded-full bg-surface border border-stroke text-muted hover:text-recording hover:border-recording/30 hover:bg-recording/10 transition-colors"
                  title="Delete model"
                >
                  <IconTrash className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Progress with real-time speed */}
        {isDownloading && (
          <div className="mt-3 space-y-1.5 pl-[44px]">
            <div className="flex items-center justify-between text-[11px] font-mono">
              <span className="text-muted">
                {progress !== undefined ? `${progress}%` : "Starting…"}
                {downloaded && total ? ` · ${formatBytes(downloaded)} / ${formatBytes(total)}` : ""}
              </span>
              <span className="text-accent tabular-nums">{formatSpeed(speedBps)}</span>
            </div>
            <div className="h-1.5 bg-elevated rounded-full overflow-hidden border border-stroke/50">
              <div className="h-full bg-accent rounded-full transition-all duration-300" style={{ width: `${progress ?? 0}%` }} />
            </div>
          </div>
        )}

        {/* Accuracy / Speed progress bars with labels */}
        <div className="flex items-center gap-4 mt-3 pl-[44px]">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className="text-[10px] font-medium tracking-widest uppercase text-muted shrink-0">Accuracy</span>
            <div className="flex-1 h-1.5 bg-elevated rounded-full overflow-hidden border border-stroke/50">
              <div className="h-full bg-accent rounded-full" style={{ width: `${info.accuracy}%` }} />
            </div>
            <span className="text-[10px] font-mono text-muted tabular-nums w-8 text-right">{info.accuracy}%</span>
          </div>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className="text-[10px] font-medium tracking-widest uppercase text-muted shrink-0">Speed</span>
            <div className="flex-1 h-1.5 bg-elevated rounded-full overflow-hidden border border-stroke/50">
              <div className="h-full bg-ready rounded-full" style={{ width: `${info.speed}%` }} />
            </div>
            <span className="text-[10px] font-mono text-muted tabular-nums w-8 text-right">{info.speed}%</span>
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-stroke/60 mt-3 pt-3 pl-[44px] flex items-center gap-3 flex-wrap">
          <button
            onClick={(e) => { e.stopPropagation(); setShowLangs(true); }}
            className="inline-flex items-center gap-1.5 text-[11px] font-mono text-muted hover:text-accent transition-colors"
            title="View supported languages"
          >
            <IconGlobe className="w-3 h-3" />
            {info.languages.length} {info.languages.length === 1 ? "language" : "languages"}
          </button>
          {info.streaming && (
            <span className="inline-flex items-center gap-1 text-[11px] font-mono text-ready" title="Supports streaming transcription">
              <IconWave className="w-3 h-3" /> Streaming
            </span>
          )}
          {info.translate && (
            <span className="inline-flex items-center gap-1 text-[11px] font-mono text-accent" title="Can translate speech to English">
              <IconTranslate className="w-3 h-3" /> Translate
            </span>
          )}
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              openUrl(info.source).catch(() => window.open(info.source, "_blank"));
            }}
            className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium text-muted hover:text-accent transition-colors"
          >
            <IconLink className="w-3 h-3" />
            Source
          </button>
        </div>
      </div>
    </>
  );
}

export default ModelCard;