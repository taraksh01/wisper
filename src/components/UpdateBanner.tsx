import { useState, useEffect, useCallback } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

type Phase = "idle" | "checking" | "downloading" | "installing" | "done";

export function UpdateBanner() {
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
    const interval = setInterval(poll, 3_600_000);
    return () => {
      mounted = false;
      clearInterval(interval);
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

  const isWorking = phase === "checking" || phase === "downloading" || phase === "installing";

  return (
    <div className="relative mb-3 px-4 py-2.5 rounded-lg bg-ready/10 ring-1 ring-ready/20">
      <p className="text-xs font-mono text-ready">
        {phase === "done" ? (
          <>
            Update installed. Restart to apply.
            <button
              onClick={handleRestart}
              className="ml-2 underline underline-offset-2 decoration-ready/40 hover:decoration-ready"
            >
              Restart
            </button>
          </>
        ) : (
          <>
            v{version} is available
            <button
              onClick={handleUpdate}
              disabled={isWorking}
              className="ml-2 underline underline-offset-2 decoration-ready/40 hover:decoration-ready disabled:opacity-40 disabled:no-underline"
            >
              {phase === "idle" && "Download & Install"}
              {phase === "checking" && "Checking..."}
              {phase === "downloading" && "Downloading..."}
            </button>
          </>
        )}
      </p>

      {phase === "downloading" && total > 0 && (
        <div className="absolute bottom-2 left-4 right-10 h-1 rounded-full bg-ready/20 overflow-hidden">
          <div className="h-full rounded-full bg-ready transition-all duration-300" style={{ width: `${Math.min(100, (progress / total) * 100)}%` }} />
        </div>
      )}

      <button
        onClick={() => setDismissed(true)}
        className="absolute top-2 right-2.5 text-ready/50 hover:text-ready transition-colors"
        aria-label="Dismiss"
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}
