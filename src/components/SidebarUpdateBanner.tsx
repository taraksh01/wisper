import { useState, useEffect, useCallback } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

type Phase = "idle" | "checking" | "downloading" | "done";

export function SidebarUpdateBanner() {
  const [available, setAvailable] = useState(false);
  const [version, setVersion] = useState("");
  const [dismissed, setDismissed] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    if (dismissed) return;
    let mounted = true;
    async function poll() {
      try {
        const update = await check();
        if (!mounted) return;
        if (update?.available) {
          setAvailable(true);
          setVersion(update.version);
        }
      } catch {}
    }
    poll();
    const id = setInterval(poll, 3_600_000);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, [dismissed]);

  const handleUpdate = useCallback(async () => {
    setPhase("checking");
    try {
      const update = await check();
      if (!update?.available) {
        setPhase("idle");
        return;
      }
      setPhase("downloading");
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          setProgress(0);
          setTotal(event.data.contentLength ?? 0);
        } else if (event.event === "Progress") {
          setProgress((p) => p + event.data.chunkLength);
        }
      });
      setPhase("done");
    } catch {
      setPhase("idle");
    }
  }, []);

  const handleRestart = useCallback(async () => {
    try {
      await relaunch();
    } catch {}
  }, []);

  if (!available || dismissed) return null;

  const pct = total > 0 ? Math.min(100, (progress / total) * 100) : 0;
  const isWorking = phase === "checking" || phase === "downloading";

  return (
    <div className="mx-2 rounded-lg bg-elevated border border-stroke overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse shrink-0" />
        <span className="text-[11px] font-mono font-medium text-ink tabular-nums">v{version}</span>
        {phase !== "idle" && phase !== "done" && (
          <span className="text-[10px] font-mono text-muted">
            {phase === "downloading" ? "downloading" : "checking…"}
          </span>
        )}
        <span className="flex-1" />
        {phase === "done" ? (
          <button
            onClick={handleRestart}
            className="text-[11px] font-medium text-accent hover:text-accent/80 transition-colors"
          >
            Restart
          </button>
        ) : (
          <button
            onClick={handleUpdate}
            disabled={isWorking}
            className="text-[11px] font-medium text-accent hover:text-accent/80 disabled:opacity-40 transition-colors"
          >
            {phase === "downloading" ? `${Math.round(pct)}%` : "Update"}
          </button>
        )}
        <button
          onClick={() => setDismissed(true)}
          className="w-6 h-6 -mr-1 grid place-items-center rounded-md text-muted/50 hover:text-muted hover:bg-surface transition-colors shrink-0"
          aria-label="Dismiss update"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
      {phase === "downloading" && total > 0 && (
        <div className="h-0.5 bg-stroke">
          <div className="h-full bg-accent transition-all duration-300" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}
