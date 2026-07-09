interface ModelInfo {
  name: string;
  size: string;
  accuracy: number;
  speed: number;
  source: string;
  languages: string[];
  format: "ggml" | "gguf";
  quantization: string;
  streaming: boolean;
  translate: boolean;
  runtime: string;
  recommended?: boolean;
}

interface ModelCardProps {
  modelKey: string;
  info: ModelInfo;
  isInstalled: boolean;
  isActive: boolean;
  isDownloading: boolean;
  progress?: number;
  onActivate: (filename: string) => void;
  onDownload: (modelKey: string) => void;
  onDelete: (filename: string) => void;
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
  onActivate,
  onDownload,
  onDelete,
}: ModelCardProps) {
  const filename = info.format === "ggml" ? `ggml-${modelKey}.bin` : `${modelKey}.gguf`;

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
        <svg className="w-5 h-5 shrink-0 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
        </svg>
        <span className="text-xs font-mono font-medium text-ink">{info.name}</span>
        {info.recommended && (
          <span className="text-[9px] font-mono text-warning bg-warning/10 px-1.5 py-0.5 rounded-sm leading-none">Recommended</span>
        )}
        <span className="text-[10px] font-mono text-muted">{info.size}</span>
        <div className="flex items-center gap-1 ml-auto">
          {isActive && chip("Active", "bg-accent/15 text-accent")}
        </div>
        {!isInstalled ? (
          <div className="flex items-center gap-2">
            {isDownloading && progress !== undefined ? (
              <div className="flex items-center gap-1.5">
                <div className="w-12 h-1.5 bg-elevated rounded-full overflow-hidden">
                  <div className="h-full rounded-full bg-accent transition-all duration-200" style={{ width: `${progress}%` }} />
                </div>
                <span className="text-[10px] font-mono text-accent tabular-nums">{progress}%</span>
              </div>
            ) : (
              <button
                onClick={(e) => { e.stopPropagation(); onDownload(modelKey); }}
                disabled={isDownloading}
                className="shrink-0 p-1.5 text-muted hover:text-accent transition-colors rounded hover:bg-accent/10 disabled:opacity-30"
                title="Download model"
              >
                {isDownloading ? (
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v8m0 0l-3-3m3 3l3-3M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
                  </svg>
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
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
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
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {info.languages.length} languages
        </span>
        {info.streaming && (
          <span className="text-[10px] font-mono text-ready flex items-center gap-1">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2 14 Q4 7 6 14 Q8 21 10 14 Q12 7 14 14 Q16 21 18 14 Q20 7 22 14" />
            </svg>
            Streaming
          </span>
        )}
        {info.translate && (
          <span className="text-[10px] font-mono text-accent flex items-center gap-1">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 21l5.25-11.25L21 21m-9-3h7.5M3 5.621a48.474 48.474 0 016-.371m0 0c0-1.457.038-2.913.119-4.363M9 5.25a48.474 48.474 0 016-.242m0 0a48.726 48.726 0 006.857-.292" />
            </svg>
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
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
          Source
        </a>
      </div>
    </div>
  );
}

export default ModelCard;