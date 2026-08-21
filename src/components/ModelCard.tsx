import { IconStack, IconClose, IconDownload, IconSpinner, IconTrash, IconGlobe, IconWave, IconTranslate, IconLink } from "./ui/icons";
import { ModelInfo, formatModelFilename } from "../types";

interface ModelCardProps {
  modelKey: string;
  info: ModelInfo;
  isInstalled: boolean;
  isActive: boolean;
  isDownloading: boolean;
  progress?: number;
  justDownloaded?: boolean;
  onActivate: (filename: string) => void;
  onDownload: (modelKey: string) => void;
  onDelete: (filename: string) => void;
  onCancel: (modelKey: string) => void;
}

const chip = (label: string, style: string) => (
  <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-sm leading-none ${style}`}>{label}</span>
);

function ModelCard({
  modelKey,
  info,
  isInstalled,
  isActive,
  isDownloading,
  progress,
  justDownloaded,
  onActivate,
  onDownload,
  onDelete,
  onCancel,
}: ModelCardProps) {
  const filename = formatModelFilename(modelKey, info.format);

  return (
    <div
      onClick={() => { if (isInstalled) onActivate(filename); }}
      className={`rounded-lg px-3 py-2.5 transition-all duration-150 cursor-pointer ${
        isActive
          ? "bg-accent/10 ring-1 ring-accent/30"
          : isInstalled
            ? "bg-elevated/40 hover:bg-elevated/60"
            : "bg-elevated/40"
      }`}
    >
      {/* Row 1: name + size + badges + action */}
      <div className="flex items-center gap-3 mb-2">
        <IconStack className="w-5 h-5 shrink-0 text-muted" />
        <span className="text-xs font-mono font-medium text-ink">{info.name}</span>
        {info.recommended && (
          <span className="text-[9px] font-mono text-warning bg-warning/10 px-1.5 py-0.5 rounded-sm leading-none">Recommended</span>
        )}
        <span className="text-[10px] font-mono text-muted">{info.size}</span>
        <div className="flex items-center gap-1 ml-auto">
          {isActive && chip("Active", "bg-accent/15 text-accent")}
          {justDownloaded && chip("Downloaded", "bg-ready/15 text-ready animate-pulse")}
        </div>
        {!isInstalled ? (
          <div className="flex items-center gap-2">
            {isDownloading && progress !== undefined ? (
              <div className="flex items-center gap-1.5">
                <div className="w-12 h-1.5 bg-elevated rounded-full overflow-hidden">
                  <div className="h-full rounded-full bg-accent transition-all duration-200" style={{ width: `${progress}%` }} />
                </div>
                <span className="text-[10px] font-mono text-accent tabular-nums">{progress}%</span>
                <button
                  onClick={(e) => { e.stopPropagation(); onCancel(modelKey); }}
                  className="shrink-0 p-1.5 text-muted hover:text-recording transition-colors rounded hover:bg-recording/10"
                  title="Cancel download"
                >
                  <IconClose className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button
                onClick={(e) => { e.stopPropagation(); onDownload(modelKey); }}
                disabled={isDownloading}
                className="shrink-0 p-1.5 text-muted hover:text-accent transition-colors rounded hover:bg-accent/10 disabled:opacity-30"
                title="Download model"
              >
                {isDownloading ? (
                  <IconSpinner className="w-4 h-4 animate-spin" />
                ) : (
                  <IconDownload className="w-4 h-4" />
                )}
              </button>
            )}
          </div>
        ) : (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(filename); }}
            className="shrink-0 p-1.5 text-muted hover:text-recording transition-colors rounded hover:bg-recording/10"
            title="Delete model"
          >
            <IconTrash className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Row 2: accuracy + speed bars */}
      <div className="flex items-center gap-3 pl-8 mb-2">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-muted font-mono">Accuracy</span>
          <div className="w-16 h-1.5 bg-elevated rounded-full overflow-hidden">
            <div className="h-full rounded-full bg-accent" style={{ width: `${info.accuracy}%` }} />
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-muted font-mono">Speed</span>
          <div className="w-16 h-1.5 bg-elevated rounded-full overflow-hidden">
            <div className="h-full rounded-full bg-ready" style={{ width: `${info.speed}%` }} />
          </div>
        </div>
      </div>

      {/* Separator */}
      <div className="border-t border-stroke/50 mb-2" />

      {/* Row 3: quantization + runtime + languages + features + source */}
      <div className="flex items-center gap-3 pl-8">
        {chip(info.quantization.toUpperCase(), "bg-elevated text-muted")}
        {chip(info.runtime, "bg-elevated text-muted")}
        <span className="text-[10px] font-mono text-muted flex items-center gap-1">
          <IconGlobe className="w-3 h-3" />
          {info.languages.length} languages
        </span>
        {info.streaming && (
          <span className="text-[10px] font-mono text-ready flex items-center gap-1">
            <IconWave className="w-3 h-3" />
            Streaming
          </span>
        )}
        {info.translate && (
          <span className="text-[10px] font-mono text-accent flex items-center gap-1">
            <IconTranslate className="w-3 h-3" />
            Translate
          </span>
        )}
        <a
          href={info.source}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="ml-auto inline-flex items-center gap-1 text-[10px] font-mono text-muted hover:text-accent transition-colors"
        >
          <IconLink className="w-3 h-3" />
          Source
        </a>
      </div>
    </div>
  );
}

export default ModelCard;