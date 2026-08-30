import { IconEngine, IconSearch, IconChevronDown } from "./ui/icons";
import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AppSettings, modelCatalog, allModelKeys, languages, formatModelFilename } from "../types";
import ModelCard from "./ModelCard";
import { Select } from "./Select";
import { Field } from "./Field";
import { SectionCard } from "./SectionCard";
import { ConfirmModal } from "./ConfirmModal";
import { Input } from "./ui/Input";
import { useToast } from "./ToastContext";

interface EngineTabProps {
  settings: AppSettings;
  onSave: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  onSaveAll: (updates: Partial<AppSettings>) => void;
}

const langOptions = [{ value: "all", label: "All languages" }, ...languages.filter((l) => l.value !== "auto")];

function sortKeys(keys: string[]) {
  return [...keys].sort((a, b) => {
    const ai = modelCatalog[a], bi = modelCatalog[b];
    const recA = ai.recommended ? 1 : 0, recB = bi.recommended ? 1 : 0;
    if (recA !== recB) return recB - recA;
    if (ai.accuracy !== bi.accuracy) return bi.accuracy - ai.accuracy;
    return bi.speed - ai.speed;
  });
}

type DownloadEntry = { progress: number; speed?: number; downloaded?: number; total?: number };
export function EngineTab({ settings, onSave, onSaveAll }: EngineTabProps) {
  const toast = useToast();
  const [localModels, setLocalModels] = useState<string[]>([]);
  const [downloads, setDownloads] = useState<Record<string, DownloadEntry>>({});
  const [justDownloaded, setJustDownloaded] = useState<string | null>(null);
  const [modelLangFilter, setModelLangFilter] = useState("all");
  const [downloadedCollapsed, setDownloadedCollapsed] = useState(false);
  const [availableCollapsed, setAvailableCollapsed] = useState(false);
  const [modelSearchQuery, setModelSearchQuery] = useState("");
  const [showDelete, setShowDelete] = useState<string | null>(null);
  const [missingAssets, setMissingAssets] = useState<Set<string>>(new Set());
  const [installingAssets, setInstallingAssets] = useState<Set<string>>(new Set());

  const fetchModels = useCallback(async () => {
    try {
      const m = await invoke<string[]>("list_local_models");
      setLocalModels(m);
      // Check which downloaded Indic models are missing tokens/vocab
      const indic = m.filter((k) => k.startsWith("indicconformer-"));
      const missing = new Set<string>();
      await Promise.all(
        indic.map(async (k) => {
          try {
            const has = await invoke<boolean>("has_model_assets", { modelName: k });
            if (!has) missing.add(k);
          } catch (e) {
            console.error("has_model_assets failed for", k, e);
          }
        })
      );
      setMissingAssets(missing);
    } catch (e) {
      console.error("list_local_models failed:", e);
    }
  }, []);

  const { addToast } = toast;

  useEffect(() => {
    fetchModels();
    const unlistenProgressPromise = listen<{ model: string; progress: number; speed_bps?: number; downloaded?: number; total?: number }>("download-progress", (event) => {
      const { model, progress, speed_bps, downloaded, total } = event.payload;
      setDownloads((prev) => ({
        ...prev,
        [model]: {
          progress,
          speed: speed_bps ?? prev[model]?.speed,
          downloaded: downloaded ?? prev[model]?.downloaded,
          total: total ?? prev[model]?.total,
        },
      }));
    });
    const unlistenCanceledPromise = listen<{ model: string }>("download-canceled", (event) => {
      const { model } = event.payload;
      setDownloads((prev) => {
        const next = { ...prev };
        delete next[model];
        return next;
      });
      addToast(`Download canceled: ${model}`, "info");
    });
    return () => {
      unlistenProgressPromise.then((fn) => fn()).catch(() => {});
      unlistenCanceledPromise.then((fn) => fn()).catch(() => {});
    };
  }, []);

  const downloadModel = async (name: string) => {
    setDownloads((prev) => ({ ...prev, [name]: { progress: 0 } }));
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
    setDownloads((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
  };

  const deleteLocalModel = async (name: string) => {
    try {
      await invoke("delete_model", { modelName: name });
      await fetchModels();
      if (settings.local_model_file === name) {
        onSave("local_model_file", "");
      }
      toast.addToast(`Deleted ${name}`, "success");
    } catch (e) {
      console.error("Delete failed:", e);
      toast.addToast(`Failed to delete ${name}`, "error");
    }
  };

  const installAssets = async (name: string) => {
    setInstallingAssets((prev) => new Set(prev).add(name));
    try {
      await invoke("install_model_assets", { modelName: name });
      toast.addToast(`Language data installed for ${name}`, "success");
      setMissingAssets((prev) => {
        const next = new Set(prev);
        next.delete(name);
        return next;
      });
    } catch (e) {
      console.error("Asset install failed:", e);
      toast.addToast(`Failed to install language data: ${String(e)}`, "error");
    } finally {
      setInstallingAssets((prev) => {
        const next = new Set(prev);
        next.delete(name);
        return next;
      });
    }
  };

  const cancelDownload = async (modelName: string) => {
    try {
      if (!modelName) return;
      await invoke("cancel_download", { modelName });
    } catch (e) {
      console.error("Cancel failed:", e);
    }
  };

  const isLocal = settings.engine_mode === "local";

  // All engine families shipped: parakeet (transcribe-rs), indicconformer +
  // moonshine (sherpa-onnx nemo_ctc / moonshine loaders).
  const enabledModelKeys = allModelKeys;

  const filtered = enabledModelKeys
    .filter((key) => modelLangFilter === "all" || modelCatalog[key].languages.includes(modelLangFilter))
    .filter((key) => !modelSearchQuery || key.toLowerCase().includes(modelSearchQuery.toLowerCase()) || modelCatalog[key].name.toLowerCase().includes(modelSearchQuery.toLowerCase()));

  const downloadedKeys = sortKeys(
    filtered.filter((k) => localModels.includes(formatModelFilename(k, modelCatalog[k].format)))
  );
  const availableKeys = sortKeys(
    filtered.filter((k) => !downloadedKeys.includes(k))
  );

  return (
    <div className="w-full space-y-4 card-enter">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <IconEngine className="w-5 h-5 text-accent" />
          <h1 className="text-sm font-semibold text-ink tracking-tight">Engine</h1>
        </div>
      </div>

      <SectionCard className="card-enter">
        <p className="text-[11px] text-muted leading-relaxed -mt-1 mb-3">
          {isLocal
            ? "Speech is converted to text entirely on your computer - private and offline."
            : "Audio is sent to a speech service for the best accuracy. Requires an API key and internet."}
        </p>
        <div className="relative bg-elevated/40 rounded-xl p-1 flex">
          <div className={`absolute top-1 bottom-1 w-1/2 rounded-lg bg-accent transition-all duration-300 ease-out ${isLocal ? "left-1" : "left-[calc(50%-2px)]"}`} />
          {(["local", "cloud"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => onSave("engine_mode", mode)}
              className={`relative z-10 flex-1 py-2.5 text-xs font-mono font-medium rounded-lg transition-colors duration-200 ${settings.engine_mode === mode ? "text-white" : "text-muted hover:text-ink"}`}
            >
              {mode === "local" ? "On this device" : "Cloud"}
            </button>
          ))}
        </div>
      </SectionCard>

      {isLocal ? (
        <>
          <SectionCard title="Models" className="card-enter">
            <div className="flex items-center gap-2 mb-4">
              <div className="relative flex-1">
                <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted pointer-events-none" />
                <Input
                  value={modelSearchQuery}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setModelSearchQuery(e.target.value)}
                  placeholder="Search models…"
                  variant="surface"
                  className="pl-9 pr-3.5"
                />
              </div>
              <Select
                value={modelLangFilter}
                options={langOptions}
                onChange={setModelLangFilter}
                searchable
                className="w-36 text-[10px]"
              />
            </div>
            {downloadedKeys.length > 0 && (
              <>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[10px] font-medium tracking-widest uppercase text-muted">Downloaded</span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-ready/10 border border-ready/15 text-ready">{downloadedKeys.length}</span>
                  <div className="flex-1 h-px bg-stroke/50" />
                  <button
                    onClick={() => setDownloadedCollapsed((v) => !v)}
                    className="shrink-0 w-6 h-6 grid place-items-center rounded-full bg-elevated border border-stroke text-muted hover:text-ink hover:border-stroke transition-colors"
                    aria-label={downloadedCollapsed ? "Expand downloaded" : "Collapse downloaded"}
                  >
                    <IconChevronDown className={`w-3 h-3 transition-transform duration-200 ${downloadedCollapsed ? "-rotate-90" : ""}`} />
                  </button>
                </div>
                {!downloadedCollapsed && (
                  <div className="grid grid-cols-1 gap-2 mb-4">
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
                        missingAssets={missingAssets.has(key)}
                        installingAssets={installingAssets.has(key)}
                        onActivate={(f) => onSave("local_model_file", f)}
                        onDownload={() => {}}
                        onDelete={(f) => setShowDelete(f)}
                        onCancel={() => {}}
                        onInstallAssets={(k) => installAssets(k)}
                      />
                    );
                  })}
                </div>
                )}
              </>
            )}
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] font-medium tracking-widest uppercase text-muted">Available</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-accent-soft border border-accent/15 text-accent">{availableKeys.length}</span>
              <div className="flex-1 h-px bg-stroke/50" />
              <button
                onClick={() => setAvailableCollapsed((v) => !v)}
                className="shrink-0 w-6 h-6 grid place-items-center rounded-full bg-elevated border border-stroke text-muted hover:text-ink hover:border-stroke transition-colors"
                aria-label={availableCollapsed ? "Expand available" : "Collapse available"}
              >
                <IconChevronDown className={`w-3 h-3 transition-transform duration-200 ${availableCollapsed ? "-rotate-90" : ""}`} />
              </button>
            </div>
            {!availableCollapsed && (
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
                    isDownloading={key in downloads}
                    progress={downloads[key]?.progress}
                    speedBps={downloads[key]?.speed}
                    downloaded={downloads[key]?.downloaded}
                    total={downloads[key]?.total}
                    justDownloaded={justDownloaded === key}
                    onActivate={() => {}}
                    onDownload={(k) => downloadModel(k)}
                    onDelete={() => {}}
                    onCancel={() => cancelDownload(key)}
                    onInstallAssets={() => {}}
                  />
                );
              })}
            </div>
            )}
          </SectionCard>

          {availableKeys.length === 0 && downloadedKeys.length === 0 && (
            <SectionCard className="card-enter">
              <div className="flex flex-col items-center justify-center text-center py-6 px-4">
                <IconSearch className="w-7 h-7 text-muted/50 mb-2" />
                <p className="text-xs text-muted">No models match. Try a different search or language.</p>
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
            <p className="text-[10px] text-muted/70 mt-1">Saved on this device only - it's sent nowhere except to your chosen service.</p>
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