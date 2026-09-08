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
    <div className="mx-1 rounded-xl bg-ready/10 ring-1 ring-ready/20 overflow-hidden">
      <div className="px-3 py-2.5 flex items-start gap-2.5">
        <span className="shrink-0 w-6 h-6 grid place-items-center rounded-lg bg-ready text-white mt-0.5">
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 16v-8" />
            <path d="M8 12l4 4 4-4" />
            <path d="M20 16v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2" />
          </svg>
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-medium text-ink leading-none">
            {phase === "done" ? "Update ready" : `v${version} available`}
          </p>
          <p className="text-[10px] font-mono text-muted leading-tight mt-1">
            {phase === "done" ? "Restart to apply" : phase === "downloading" ? "Downloading…" : "New version ready to install"}
          </p>
          <div className="flex items-center gap-2 mt-2">
            {phase === "done" ? (
              <button
                onClick={handleRestart}
                className="text-[11px] font-medium text-ready hover:text-ready/80 transition-colors"
              >
                Restart now →
              </button>
            ) : (
              <button
                onClick={handleUpdate}
                disabled={isWorking}
                className="text-[11px] font-medium text-ready hover:text-ready/80 disabled:opacity-40 transition-colors"
              >
                {phase === "checking" ? "Checking…" : phase === "downloading" ? "Downloading…" : "Update now"}
              </button>
            )}
            <button
              onClick={() => setDismissed(true)}
              className="text-[10px] font-mono text-muted hover:text-ink transition-colors ml-auto"
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
      {phase === "downloading" && total > 0 && (
        <div className="h-1 bg-ready/20">
          <div className="h-full bg-ready transition-all duration-300" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}
