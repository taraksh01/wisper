import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { AppSettings, modelCatalog, allModelKeys, languages, formatModelFilename } from "../types";
import ModelCard from "./ModelCard";
import { Select } from "./Select";
import { Field } from "./Field";
import { SectionCard } from "./SectionCard";
import { ConfirmModal } from "./ConfirmModal";
import { useToast } from "./ToastContext";

interface EngineTabProps {
  settings: AppSettings;
  onSave: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  onSaveAll: (updates: Partial<AppSettings>) => void;
}

const langOptions = [{ value: "all", label: "All languages" }, ...languages.filter((l) => l.value !== "auto")];

function sortKeys(keys: string[]) {
  return keys.sort((a, b) => {
    const ai = modelCatalog[a], bi = modelCatalog[b];
    const recA = ai.recommended ? 1 : 0, recB = bi.recommended ? 1 : 0;
    if (recA !== recB) return recB - recA;
    if (ai.accuracy !== bi.accuracy) return bi.accuracy - ai.accuracy;
    return bi.speed - ai.speed;
  });
}

export function EngineTab({ settings, onSave, onSaveAll }: EngineTabProps) {
  const toast = useToast();
  const [localModels, setLocalModels] = useState<string[]>([]);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({});
  const [justDownloaded, setJustDownloaded] = useState<string | null>(null);
  const [modelLangFilter, setModelLangFilter] = useState("all");
  const [modelSearchQuery, setModelSearchQuery] = useState("");
  const [showDelete, setShowDelete] = useState<string | null>(null);

  const fetchModels = useCallback(async () => {
    try {
      const m = await invoke<string[]>("list_local_models");
      setLocalModels(m);
    } catch {}
  }, []);

  const { addToast } = toast;

  useEffect(() => {
    fetchModels();
    let cancelled = false;
    let unlistenProgress: UnlistenFn | undefined;
    let unlistenCanceled: UnlistenFn | undefined;
    (async () => {
      unlistenProgress = await listen<{ model: string; progress: number }>("download-progress", (event) => {
        const { model, progress } = event.payload;
        setDownloadProgress((prev) => ({ ...prev, [model]: progress }));
      });
      unlistenCanceled = await listen<{ model: string }>("download-canceled", (event) => {
        const { model } = event.payload;
        setDownloading(null);
        setDownloadProgress((prev) => {
          const next = { ...prev };
          delete next[model];
          return next;
        });
        addToast(`Download canceled: ${model}`, "info");
      });
      if (cancelled) {
        if (unlistenProgress) unlistenProgress();
        if (unlistenCanceled) unlistenCanceled();
      }
    })();
    return () => {
      cancelled = true;
      if (unlistenProgress) unlistenProgress();
      if (unlistenCanceled) unlistenCanceled();
    };
  }, []);

  const downloadModel = async (name: string) => {
    setDownloading(name);
    try {
      await invoke("download_model", { modelName: name });
      toast.addToast(`Downloaded ${name}`, "success");
      setJustDownloaded(name);
      setTimeout(() => setJustDownloaded(null), 3000);
      await fetchModels();
    } catch (e) {
      const msg = String(e).toLowerCase();
      if (!msg.includes("cancel")) {
        console.error("Download failed:", e);
        toast.addToast(`Failed to download ${name}`, "error");
      }
    }
    setDownloading(null);
    setDownloadProgress((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
  };

  const deleteLocalModel = async (name: string) => {
    try {
      await invoke("delete_model", { modelName: name });
      await fetchModels();
      toast.addToast(`Deleted ${name}`, "success");
    } catch (e) {
      console.error("Delete failed:", e);
      toast.addToast(`Failed to delete ${name}`, "error");
    }
  };

  const cancelDownload = async () => {
    try {
      await invoke("cancel_download");
    } catch (e) {
      console.error("Cancel failed:", e);
    }
  };

  const isLocal = settings.engine_mode === "local";

  const filtered = allModelKeys
    .filter((key) => modelLangFilter === "all" || modelCatalog[key].languages.includes(modelLangFilter))
    .filter((key) => !modelSearchQuery || key.toLowerCase().includes(modelSearchQuery.toLowerCase()) || modelCatalog[key].name.toLowerCase().includes(modelSearchQuery.toLowerCase()));

  const downloadedKeys = sortKeys(
    filtered.filter((k) => localModels.includes(formatModelFilename(k, modelCatalog[k].format)))
  );
  const availableKeys = sortKeys(
    filtered.filter((k) => !downloadedKeys.includes(k))
  );

  return (
    <div className="max-w-lg space-y-4 card-enter">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
          <h1 className="text-sm font-semibold text-ink tracking-tight">Engine</h1>
        </div>
      </div>

      <SectionCard className="card-enter">
        <div className="relative bg-elevated/40 rounded-xl p-1 flex">
          <div className={`absolute top-1 bottom-1 w-1/2 rounded-lg bg-accent transition-all duration-300 ease-out ${isLocal ? "left-1" : "left-[calc(50%-2px)]"}`} />
          {(["local", "cloud"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => onSave("engine_mode", mode)}
              className={`relative z-10 flex-1 py-2.5 text-xs font-mono font-medium rounded-lg transition-colors duration-200 ${settings.engine_mode === mode ? "text-white" : "text-muted hover:text-ink"}`}
            >
              {mode === "local" ? "Local Engine" : "Cloud API"}
            </button>
          ))}
        </div>
      </SectionCard>

      {isLocal ? (
        <>
          <SectionCard className="card-enter">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <svg className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted/50 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <circle cx="11" cy="11" r="7" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="m20 20-4.35-4.35" />
                </svg>
                <input
                  value={modelSearchQuery}
                  onChange={(e) => setModelSearchQuery(e.target.value)}
                  placeholder="Search models…"
                  className="w-full bg-elevated/50 rounded-md px-7 py-1.5 text-xs font-mono text-ink placeholder:text-muted/50 outline-none ring-1 ring-stroke focus:ring-accent/40 transition-all"
                />
              </div>
              <Select
                value={modelLangFilter}
                options={langOptions}
                onChange={setModelLangFilter}
                className="w-32 text-[10px]"
              />
            </div>
          </SectionCard>

          <SectionCard title={`Downloaded (${downloadedKeys.length})`} className="card-enter">
            <div className="grid grid-cols-1 gap-2">
              {downloadedKeys.map((key) => {
                const info = modelCatalog[key];
                return (
                  <ModelCard
                    key={key}
                    modelKey={key}
                    info={info}
                    isInstalled={true}
                    isActive={settings.local_model_file === formatModelFilename(key, info.format)}
                    isDownloading={false}
                    justDownloaded={justDownloaded === key}
                    onActivate={(f) => onSave("local_model_file", f)}
                    onDownload={() => {}}
                    onDelete={(f) => setShowDelete(f)}
                    onCancel={() => {}}
                  />
                );
              })}
            </div>
          </SectionCard>

          <SectionCard title={`Available to Download (${availableKeys.length})`} className="card-enter">
            <div className="grid grid-cols-1 gap-2">
              {availableKeys.map((key) => {
                const info = modelCatalog[key];
                return (
                  <ModelCard
                    key={key}
                    modelKey={key}
                    info={info}
                    isInstalled={false}
                    isActive={false}
                    isDownloading={downloading === key}
                    progress={downloadProgress[key]}
                    justDownloaded={justDownloaded === key}
                    onActivate={() => {}}
                    onDownload={(k) => downloadModel(k)}
                    onDelete={() => {}}
                    onCancel={() => cancelDownload()}
                  />
                );
              })}
            </div>
          </SectionCard>

          {availableKeys.length === 0 && downloadedKeys.length === 0 && (
            <SectionCard className="card-enter">
              <div className="flex flex-col items-center justify-center text-center py-6 px-4">
                <svg className="w-7 h-7 text-muted/50 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="7" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="m20 20-4.35-4.35" />
                </svg>
                <p className="text-xs text-muted">No models match your filters.</p>
              </div>
            </SectionCard>
          )}
        </>
      ) : (
        <>
          <SectionCard title="Provider" className="card-enter">
            <div className="relative bg-elevated/40 rounded-xl p-1 flex mb-4">
              <div className={`absolute top-1 bottom-1 w-1/3 rounded-lg bg-accent transition-all duration-300 ease-out ${
                settings.engine_provider === "openai" ? "left-1" : settings.engine_provider === "groq" ? "left-[calc(33.333%-1px)]" : "left-[calc(66.666%-2px)]"
              }`} />
              {(["openai", "groq", "custom"] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => {
                    const updates: Partial<AppSettings> = { engine_provider: p };
                    if (p === "openai") {
                      updates.engine_model = "whisper-1";
                      updates.engine_base_url = "";
                    } else if (p === "groq") {
                      updates.engine_model = "whisper-large-v3";
                      updates.engine_base_url = "https://api.groq.com/openai/v1";
                    }
                    onSaveAll(updates);
                  }}
                  className={`relative z-10 flex-1 py-2.5 text-xs font-mono font-medium rounded-lg transition-colors duration-200 ${settings.engine_provider === p ? "text-white" : "text-muted hover:text-ink"}`}
                >
                  {p === "openai" ? "OpenAI" : p === "groq" ? "Groq" : "Custom"}
                </button>
              ))}
            </div>

            {settings.engine_provider === "custom" ? (
              <>
                <Field label="Base URL" value={settings.engine_base_url} onChange={(v) => onSave("engine_base_url", v)} placeholder="https://api.openai.com/v1" />
                <Field label="Model" value={settings.engine_model} onChange={(v) => onSave("engine_model", v)} placeholder="whisper-1" />
              </>
            ) : (
              <Field label="Model" value={settings.engine_model} onChange={(v) => onSave("engine_model", v)} />
            )}

            <Field
              label="API Key"
              value={settings.voice_api_key}
              onChange={(v) => onSave("voice_api_key", v)}
              secret
              placeholder={settings.engine_provider === "openai" ? "sk-..." : settings.engine_provider === "groq" ? "gsk_..." : "API key"}
            />
            <p className="text-[10px] text-muted/70 mt-1">Stored locally. Never leaves your device except to call the provider.</p>
          </SectionCard>
        </>
      )}

      {showDelete && (
        <ConfirmModal
          title="Delete model?"
          message={`This will permanently delete ${showDelete} from your device. You can re-download it later.`}
          confirmLabel="Delete"
          onConfirm={() => {
            const name = showDelete;
            setShowDelete(null);
            deleteLocalModel(name);
          }}
          onCancel={() => setShowDelete(null)}
        />
      )}
    </div>
  );
}
