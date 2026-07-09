import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import ModelCard from "./components/ModelCard";
import "./styles.css";

function useSystemTheme() {
  const [dark, setDark] = useState(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return dark;
}

interface HistoryEntry {
  id: number;
  raw_text: string;
  formatted_text: string | null;
  agent_name: string | null;
  duration_ms: number;
  word_count: number;
  created_at: string;
}

interface SmartAgent {
  name: string;
  system_prompt: string;
  active: boolean;
}

interface AppSettings {
  stt_mode: string;
  stt_provider: string;
  stt_base_url: string;
  stt_api_key: string;
  stt_model: string;
  local_model_file: string;
  llm_enabled: boolean;
  llm_base_url: string;
  llm_api_key: string;
  llm_model: string;
  llm_agent_name: string;
  hotkey: string;
  hotkey_mode: string;
  paste_method: string;
  vad_enabled: boolean;
  vad_threshold: number;
  language: string;
}

const openaiModels = ["whisper-1"];

const groqModels = [
  "whisper-large-v3",
  "whisper-large-v3-turbo",
  "distil-whisper-large-v3-en",
];

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

const modelCatalog: Record<string, ModelInfo> = {
  "tiny.en": {
    name: "Tiny English",
    size: "~75 MB",
    accuracy: 94,
    speed: 95,
    source: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin",
    languages: ["en"],
    format: "ggml",
    quantization: "f32",
    streaming: false,
    translate: false,
    runtime: "whisper.cpp",
  },
  "base.en": {
    name: "Base English",
    size: "~142 MB",
    accuracy: 96,
    speed: 85,
    source: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin",
    languages: ["en"],
    format: "ggml",
    quantization: "f32",
    streaming: false,
    translate: false,
    runtime: "whisper.cpp",
  },
  "small.en": {
    name: "Small English",
    size: "~466 MB",
    accuracy: 97,
    speed: 65,
    source: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin",
    languages: ["en"],
    format: "ggml",
    quantization: "f32",
    streaming: false,
    translate: false,
    runtime: "whisper.cpp",
  },
  "tiny": {
    name: "Tiny Multilingual",
    size: "~75 MB",
    accuracy: 93,
    speed: 95,
    source: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin",
    languages: ["en", "es", "fr", "de", "it", "pt", "nl", "ja", "ko", "zh", "ar", "hi", "ru"],
    format: "ggml",
    quantization: "f32",
    streaming: false,
    translate: false,
    runtime: "whisper.cpp",
  },
  "base": {
    name: "Base Multilingual",
    size: "~142 MB",
    accuracy: 95,
    speed: 85,
    source: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
    languages: ["en", "es", "fr", "de", "it", "pt", "nl", "ja", "ko", "zh", "ar", "hi", "ru"],
    format: "ggml",
    quantization: "f32",
    streaming: false,
    translate: false,
    runtime: "whisper.cpp",
  },
  "small": {
    name: "Small Multilingual",
    size: "~466 MB",
    accuracy: 95,
    speed: 55,
    source: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin",
    languages: ["en", "es", "fr", "de", "it", "pt", "nl", "ja", "ko", "zh", "ar", "hi", "ru"],
    format: "ggml",
    quantization: "f32",
    streaming: false,
    translate: false,
    runtime: "whisper.cpp",
  },
  "medium": {
    name: "Medium Multilingual",
    size: "~1.5 GB",
    accuracy: 96,
    speed: 40,
    source: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin",
    languages: ["en", "es", "fr", "de", "it", "pt", "nl", "ja", "ko", "zh", "ar", "hi", "ru"],
    format: "ggml",
    quantization: "f32",
    streaming: false,
    translate: false,
    runtime: "whisper.cpp",
  },
  "large-v3": {
    name: "Large V3 Multilingual",
    size: "~2.9 GB",
    accuracy: 98,
    speed: 10,
    source: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin",
    languages: ["en", "es", "fr", "de", "it", "pt", "nl", "ja", "ko", "zh", "ar", "hi", "ru"],
    format: "ggml",
    quantization: "f32",
    streaming: false,
    translate: false,
    runtime: "whisper.cpp",
  },
  "large-v3-turbo": {
    name: "Large V3 Turbo",
    size: "~1.6 GB",
    accuracy: 96,
    speed: 70,
    source: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin",
    languages: ["en", "es", "fr", "de", "it", "pt", "nl", "ja", "ko", "zh", "ar", "hi", "ru"],
    format: "ggml",
    quantization: "f32",
    streaming: false,
    translate: false,
    runtime: "whisper.cpp",
  },
  "parakeet-tdt_ctc-110m": {
    name: "Parakeet TDT+CTC 110M",
    size: "~480 MB",
    accuracy: 92,
    speed: 98,
    source: "https://huggingface.co/mudler/parakeet-cpp-gguf/resolve/main/parakeet-tdt_ctc-110m-f16.gguf",
    languages: ["en"],
    format: "gguf",
    quantization: "f16",
    streaming: false,
    translate: false,
    runtime: "parakeet.cpp",
  },
  "parakeet-tdt-0.6b-v2": {
    name: "Parakeet TDT 0.6B V2",
    size: "~1.4 GB",
    accuracy: 97,
    speed: 72,
    source: "https://huggingface.co/mudler/parakeet-cpp-gguf/resolve/main/tdt-0.6b-v2-f16.gguf",
    languages: ["en"],
    format: "gguf",
    quantization: "f16",
    streaming: true,
    translate: false,
    runtime: "parakeet.cpp",
    recommended: true,
  },
  "parakeet-tdt-0.6b-v3": {
    name: "Parakeet TDT 0.6B V3",
    size: "~1.4 GB",
    accuracy: 96,
    speed: 72,
    source: "https://huggingface.co/mudler/parakeet-cpp-gguf/resolve/main/tdt-0.6b-v3-f16.gguf",
    languages: ["en", "es", "fr", "de", "it", "pt", "nl"],
    format: "gguf",
    quantization: "f16",
    streaming: true,
    translate: false,
    runtime: "parakeet.cpp",
    recommended: true,
  },
  "parakeet-ctc-0.6b": {
    name: "Parakeet CTC 0.6B",
    size: "~1.3 GB",
    accuracy: 93,
    speed: 75,
    source: "https://huggingface.co/mudler/parakeet-cpp-gguf/resolve/main/parakeet-ctc-0.6b-f16.gguf",
    languages: ["en"],
    format: "gguf",
    quantization: "f16",
    streaming: false,
    translate: false,
    runtime: "parakeet.cpp",
  },
  "parakeet-tdt-1.1b": {
    name: "Parakeet TDT 1.1B",
    size: "~2.3 GB",
    accuracy: 98,
    speed: 40,
    source: "https://huggingface.co/mudler/parakeet-cpp-gguf/resolve/main/parakeet-tdt-1.1b-f16.gguf",
    languages: ["en"],
    format: "gguf",
    quantization: "f16",
    streaming: true,
    translate: false,
    runtime: "parakeet.cpp",
  },
};

const allModelKeys = Object.keys(modelCatalog);

const languages = [
  { value: "auto", label: "Auto-detect" },
  { value: "en", label: "English" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "it", label: "Italian" },
  { value: "pt", label: "Portuguese" },
  { value: "nl", label: "Dutch" },
  { value: "ja", label: "Japanese" },
  { value: "ko", label: "Korean" },
  { value: "zh", label: "Chinese" },
  { value: "ar", label: "Arabic" },
  { value: "hi", label: "Hindi" },
  { value: "ru", label: "Russian" },
];

const tabs = [
  { id: "general", label: "General" },
  { id: "stt", label: "Engine" },
  { id: "llm", label: "Process" },
  { id: "paste", label: "Paste" },
  { id: "history", label: "History" },
];

function App() {
  const dark = useSystemTheme();
  const [activeTab, setActiveTab] = useState("stt");
  const [appState, setAppState] = useState("idle");
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [stats, setStats] = useState<[number, number, number]>([0, 0, 0]);
  const [localModels, setLocalModels] = useState<string[]>([]);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({});
  const [agents, setAgents] = useState<SmartAgent[]>([]);
  const [modelsPath, setModelsPath] = useState("");
  const [modelLangFilter, setModelLangFilter] = useState("all");
  const [modelSearchQuery, setModelSearchQuery] = useState("");

  useEffect(() => {
    invoke<AppSettings>("load_settings").then(setSettings).catch(console.error);
    fetchHistory();
    fetchModels();
    fetchAgents();
    invoke<string>("get_models_dir_path").then(setModelsPath).catch(console.error);
    invoke<string>("get_current_state").then(setAppState).catch(console.error);

    let unlisten: UnlistenFn | undefined;
    let unlistenProgress: UnlistenFn | undefined;
    (async () => {
      unlisten = await listen<string>("v3:state", (event) => {
        setAppState(event.payload);
      });
      unlistenProgress = await listen<{ model: string; progress: number }>("download-progress", (event) => {
        const { model, progress } = event.payload;
        setDownloadProgress((prev) => ({ ...prev, [model]: progress }));
      });
    })();

    return () => {
      if (unlisten) unlisten();
      if (unlistenProgress) unlistenProgress();
    };
  }, []);

  const fetchHistory = useCallback(async () => {
    try {
      const h = await invoke<HistoryEntry[]>("get_history_entries", { limit: 50 });
      setHistory(h);
      const s = await invoke<[number, number, number]>("get_history_stats");
      setStats(s);
    } catch {}
  }, []);

  const fetchModels = useCallback(async () => {
    try {
      const m = await invoke<string[]>("list_local_models");
      setLocalModels(m);
    } catch {}
  }, []);

  const fetchAgents = useCallback(async () => {
    try {
      const a = await invoke<SmartAgent[]>("get_default_agents");
      setAgents(a);
    } catch {}
  }, []);

  const downloadModel = async (name: string) => {
    setDownloading(name);
    try {
      await invoke("download_model", { modelName: name });
      await fetchModels();
    } catch (e) {
      console.error("Download failed:", e);
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
    } catch (e) {
      console.error("Delete failed:", e);
    }
  };

  const saveSetting = (key: keyof AppSettings, value: any) => {
    if (!settings) return;
    const updated = { ...settings, [key]: value };
    setSettings(updated);
    invoke("save_settings", { settings: updated }).catch(console.error);
  };

  const resetTabSettings = async () => {
    try {
      const defaults = await invoke<AppSettings>("get_default_settings");
      const merged = { ...defaults };
      setSettings(merged);
      await invoke("save_settings", { settings: merged });
    } catch (e) {
      console.error("Reset failed:", e);
    }
  };

  if (!settings) {
    return (
      <div className="h-screen bg-base flex items-center justify-center">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-accent animate-pulse" />
          <span className="text-sm font-mono text-muted">loading</span>
        </div>
      </div>
    );
  }

  const renderSTT = () => {
    const isLocal = settings.stt_mode === "local";

    return (
    <div className="flex flex-col h-full panel-enter">
      <div className="flex items-center justify-between mb-1">
        <div />
        <button
          onClick={resetTabSettings}
          className="text-[10px] font-mono text-accent/60 hover:text-accent transition-colors flex items-center gap-1"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Reset tab
        </button>
      </div>

      {/* Full-width mode slider */}
      <div className="relative bg-elevated/40 rounded-xl p-1 flex mb-6 panel-enter">
        <div
          className={`absolute top-1 bottom-1 w-1/2 rounded-lg bg-accent transition-all duration-300 ease-out ${
            isLocal ? "left-1" : "left-[calc(50%-2px)]"
          }`}
        />
        {["local", "cloud"].map((mode) => (
          <button
            key={mode}
            onClick={() => saveSetting("stt_mode", mode)}
            className={`relative z-10 flex-1 py-2.5 text-xs font-mono font-medium rounded-lg transition-colors duration-200 ${
              settings.stt_mode === mode
                ? "text-white"
                : "text-muted hover:text-ink"
            }`}
          >
            {mode === "local" ? "Local (Whisper)" : "Cloud API"}
          </button>
        ))}
      </div>

      {/* Animated content panel */}
      <div className="relative flex-1">
        <div
          className={`transition-all duration-300 ease-out ${
            isLocal
              ? "opacity-100 translate-y-0"
              : "opacity-0 translate-y-2 pointer-events-none absolute inset-0"
          }`}
        >
          <div className="space-y-4">
            <p className="text-[10px] text-muted mb-1">Stored at <span className="text-ink">{modelsPath}</span></p>
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="relative flex-1">
                  <svg className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted/50 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <circle cx="11" cy="11" r="7" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="m20 20-4.35-4.35" />
                  </svg>
                  <input
                    type="text"
                    value={modelSearchQuery}
                    onChange={(e) => setModelSearchQuery(e.target.value)}
                    placeholder="Search model by name..."
                    className="w-full text-[10px] font-mono bg-elevated/50 rounded-md pl-7 pr-2 py-1.5 text-muted placeholder:text-muted/40 outline-none ring-1 ring-stroke focus:ring-accent/40 transition-all"
                  />
                </div>
                <div className="w-36 shrink-0">
                  <Select
                    value={modelLangFilter}
                    options={[{ value: "all", label: "All languages" }, ...languages.filter(l => l.value !== "auto")]}
                    onChange={(v) => setModelLangFilter(v)}
                  />
                </div>
              </div>

              <>
                {(() => {
                  const filtered = allModelKeys
                    .filter((key) => modelLangFilter === "all" || modelCatalog[key].languages.includes(modelLangFilter))
                    .filter((key) => !modelSearchQuery || key.toLowerCase().includes(modelSearchQuery.toLowerCase()) || modelCatalog[key].name.toLowerCase().includes(modelSearchQuery.toLowerCase()));
                  const downloadedKeys = filtered.filter((k) => localModels.includes(modelCatalog[k].format === "ggml" ? `ggml-${k}.bin` : `${k}.gguf`)).sort((a, b) => {
                    const ai = modelCatalog[a], bi = modelCatalog[b];
                    const recA = ai.recommended ? 1 : 0, recB = bi.recommended ? 1 : 0;
                    if (recA !== recB) return recB - recA;
                    if (ai.accuracy !== bi.accuracy) return bi.accuracy - ai.accuracy;
                    return bi.speed - ai.speed;
                  });
                  const availableKeys = filtered.filter((k) => !downloadedKeys.includes(k)).sort((a, b) => {
                    const ai = modelCatalog[a], bi = modelCatalog[b];
                    const recA = ai.recommended ? 1 : 0, recB = bi.recommended ? 1 : 0;
                    if (recA !== recB) return recB - recA;
                    if (ai.accuracy !== bi.accuracy) return bi.accuracy - ai.accuracy;
                    return bi.speed - ai.speed;
                  });

                  const makeCards = (keys: string[], isDownloadedSection: boolean) =>
                    keys.map((key) => {
                      const info = modelCatalog[key];
                      const filename = info.format === "ggml" ? `ggml-${key}.bin` : `${key}.gguf`;
                      return (
                        <ModelCard
                          key={key}
                          modelKey={key}
                          info={info}
                          isInstalled={isDownloadedSection}
                          isActive={isDownloadedSection && settings.local_model_file === filename}
                          isDownloading={!isDownloadedSection && downloading === key}
                          progress={!isDownloadedSection ? downloadProgress[key] : undefined}
                          onActivate={(f) => saveSetting("local_model_file", f)}
                          onDownload={(k) => downloadModel(k)}
                          onDelete={(f) => deleteLocalModel(f)}
                        />
                      );
                    });

                  return (
                    <>
                      {downloadedKeys.length > 0 && (
                        <div className="mb-5">
                          <div className="text-xs font-mono text-muted tracking-wider uppercase mb-3"><span>Downloaded</span><span className="tabular-nums text-muted/60 ml-1">({downloadedKeys.length})</span></div>
                          <div className="grid grid-cols-1 gap-2">
                            {makeCards(downloadedKeys, true)}
                          </div>
                        </div>
                      )}
                      <div>
                        <div className="text-xs font-mono text-muted tracking-wider uppercase mb-3"><span>Available to Download</span><span className="tabular-nums text-muted/60 ml-1">({availableKeys.length})</span></div>
                        <div className="grid grid-cols-1 gap-2">
                          {availableKeys.length > 0 ? makeCards(availableKeys, false) : (
                            <p className="text-xs text-muted">No models match your filters.</p>
                          )}
                        </div>
                      </div>
                    </>
                  );
                })()}
              </>
            </div>
          </div>
        </div>

        <div
          className={`transition-all duration-300 ease-out ${
            !isLocal
              ? "opacity-100 translate-y-0"
              : "opacity-0 translate-y-2 pointer-events-none absolute inset-0"
          }`}
        >
          <div className="space-y-4">
            <div>
              <label className="text-[11px] font-mono text-muted block mb-1.5 tracking-wider">Provider</label>
              <div className="relative bg-elevated/40 rounded-xl p-1 flex mb-4">
                <div
                  className={`absolute top-1 bottom-1 w-1/3 rounded-lg bg-accent transition-all duration-300 ease-out ${
                    settings.stt_provider === "openai" ? "left-1" :
                    settings.stt_provider === "groq" ? "left-1/3" :
                    "left-2/3"
                  }`}
                />
                {[
                  { id: "openai", label: "OpenAI" },
                  { id: "groq", label: "Groq" },
                  { id: "custom", label: "Custom" },
                ].map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      const updates: Partial<AppSettings> = { stt_provider: p.id };
                      if (p.id === "openai") {
                        updates.stt_model = "whisper-1";
                        updates.stt_base_url = "";
                      } else if (p.id === "groq") {
                        updates.stt_model = "whisper-large-v3";
                        updates.stt_base_url = "https://api.groq.com/openai/v1";
                      }
                      if (!settings) return;
                      const merged = { ...settings, ...updates };
                      setSettings(merged);
                      invoke("save_settings", { settings: merged }).catch(console.error);
                    }}
                    className={`relative z-10 flex-1 py-2.5 text-xs font-mono font-medium rounded-lg transition-colors duration-200 ${
                      settings.stt_provider === p.id
                        ? "text-white"
                        : "text-muted hover:text-ink"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <Field label="API Key" value={settings.stt_api_key} onChange={(v) => saveSetting("stt_api_key", v)} placeholder="sk-..." password />

            <div className="relative">
              <div
                className={`transition-all duration-300 ease-out ${
                  settings.stt_provider === "openai"
                    ? "opacity-100 translate-y-0"
                    : "opacity-0 translate-y-2 pointer-events-none absolute inset-0"
                }`}
              >
                <Select label="Model" value={settings.stt_model} options={openaiModels.map((m) => ({ value: m, label: m }))} onChange={(v) => saveSetting("stt_model", v)} />
              </div>

              <div
                className={`transition-all duration-300 ease-out ${
                  settings.stt_provider === "groq"
                    ? "opacity-100 translate-y-0"
                    : "opacity-0 translate-y-2 pointer-events-none absolute inset-0"
                }`}
              >
                <Select label="Model" value={settings.stt_model} options={groqModels.map((m) => ({ value: m, label: m }))} onChange={(v) => saveSetting("stt_model", v)} />
              </div>

              <div
                className={`transition-all duration-300 ease-out ${
                  settings.stt_provider === "custom"
                    ? "opacity-100 translate-y-0"
                    : "opacity-0 translate-y-2 pointer-events-none absolute inset-0"
                }`}
              >
                <Field label="Base URL" value={settings.stt_base_url} onChange={(v) => saveSetting("stt_base_url", v)} placeholder="https://api.openai.com/v1" />
                <div className="mt-3">
                  <Field label="Model" value={settings.stt_model} onChange={(v) => saveSetting("stt_model", v)} placeholder="whisper-1" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="border-t border-stroke pt-4 mt-4 panel-enter">
        <label className="flex items-center gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={settings.vad_enabled}
            onChange={(e) => saveSetting("vad_enabled", e.target.checked)}
            className="accent-accent size-3.5 shrink-0"
          />
          <span className="text-xs text-muted">Trim silence from recordings</span>
        </label>
      </div>
    </div>
    );
  };

  const renderLLM = () => (
    <div className="space-y-3 panel-enter">
      <div className="flex items-center justify-between panel-enter">
        <div />
        <button
          onClick={resetTabSettings}
          className="text-[10px] font-mono text-accent/60 hover:text-accent transition-colors flex items-center gap-1"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Reset tab
        </button>
      </div>

      <section className="panel-enter flex items-center justify-between">
        <span className="text-xs font-mono text-muted tracking-wider uppercase">LLM Post-Processing</span>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.llm_enabled}
            onChange={(e) => saveSetting("llm_enabled", e.target.checked)}
            className="accent-accent size-3.5"
          />
          <span className="text-xs text-muted font-mono">Enabled</span>
        </label>
      </section>

      {settings.llm_enabled && (
        <>
          <section className="panel-enter space-y-2.5">
            <Field label="Base URL" value={settings.llm_base_url} onChange={(v) => saveSetting("llm_base_url", v)} placeholder="http://localhost:11434/v1" />
            <Field label="API Key" value={settings.llm_api_key} onChange={(v) => saveSetting("llm_api_key", v)} placeholder="sk-..." password />
            <Field label="Model" value={settings.llm_model} onChange={(v) => saveSetting("llm_model", v)} placeholder="llama3.2" />
          </section>

          <section className="panel-enter">
            <div className="text-xs font-mono text-muted mb-3 tracking-wider uppercase">Smart Agents</div>
            {agents.map((agent) => (
              <div key={agent.name} className="mb-3 last:mb-0">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-xs font-mono text-ink">{agent.name}</span>
                  {agent.active && (
                    <span className="text-[10px] font-mono bg-accent/15 text-accent px-1.5 py-0.5 rounded-sm">active</span>
                  )}
                </div>
                <textarea
                  readOnly
                  value={agent.system_prompt}
                  className="w-full bg-elevated/50 rounded-md px-2.5 py-1.5 text-xs text-muted leading-relaxed h-18 resize-none outline-none ring-1 ring-stroke"
                />
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  );

  

  const renderPaste = () => (
    <div className="space-y-3 panel-enter">
      <div className="flex items-center justify-between panel-enter">
        <div />
        <button
          onClick={resetTabSettings}
          className="text-[10px] font-mono text-accent/60 hover:text-accent transition-colors flex items-center gap-1"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Reset tab
        </button>
      </div>

      <section className="panel-enter">
        <div className="text-xs font-mono text-muted mb-2 tracking-wider uppercase">Paste Method</div>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {["Ctrl+V", "Ctrl+Shift+V", "Shift+Insert", "Direct Typing"].map((method) => (
            <button
              key={method}
              onClick={() => saveSetting("paste_method", method)}
              className={`px-3 py-1.5 text-xs font-mono font-medium rounded-md transition-all duration-150 ${
                settings.paste_method === method
                  ? "bg-accent/15 text-accent ring-1 ring-accent/30"
                  : "text-muted hover:text-ink hover:bg-elevated"
              }`}
            >
              {method}
            </button>
          ))}
        </div>
        <div className="text-[11px] text-muted">
          Display server: <span className="text-accent">Auto-detected</span>
        </div>
      </section>
    </div>
  );

  const renderHistory = () => (
    <div className="space-y-3 panel-enter">
      <section className="panel-enter">
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "Dictations", value: stats[0] },
            { label: "Words", value: stats[1] },
            { label: "Avg Words", value: stats[2].toFixed(1) },
          ].map((s) => (
            <div key={s.label} className="bg-elevated/30 rounded-lg px-3 py-2.5 text-center">
              <div className="text-lg font-bold font-mono text-accent tabular-nums">{s.value}</div>
              <div className="text-[10px] font-mono text-muted mt-0.5 tracking-wider uppercase">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="panel-enter">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs font-mono text-muted tracking-wider uppercase">Recent</div>
          <button
            onClick={fetchHistory}
            className="text-[11px] font-mono text-accent hover:text-accent-dim transition-colors"
          >
            Refresh
          </button>
        </div>
        {history.length === 0 ? (
          <p className="text-xs text-muted">No history yet. Press {settings.hotkey} to dictate.</p>
        ) : (
          <div className="space-y-1.5 max-h-72 overflow-y-auto custom-scrollbar">
            {history.map((entry) => (
              <div
                key={entry.id}
                className="bg-elevated/30 rounded-md px-2.5 py-2 hover:bg-elevated/60 transition-colors cursor-pointer"
                onClick={() => navigator.clipboard.writeText(entry.formatted_text || entry.raw_text)}
              >
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-[10px] font-mono text-muted">{entry.created_at}</span>
                  <span className="text-[10px] font-mono text-muted tabular-nums">{entry.word_count}</span>
                </div>
                <p className="text-xs text-ink leading-relaxed line-clamp-2" title={entry.formatted_text || entry.raw_text}>
                  {entry.formatted_text || entry.raw_text}
                </p>
                {entry.agent_name && (
                  <span className="text-[10px] text-accent/70 mt-0.5 block">{entry.agent_name}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );

  const renderGeneral = () => (
    <div className="space-y-4 panel-enter">
      <div className="flex items-center justify-between panel-enter">
        <div />
        <button
          onClick={resetTabSettings}
          className="text-[10px] font-mono text-accent/60 hover:text-accent transition-colors flex items-center gap-1"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Reset tab
        </button>
      </div>

      <section className="panel-enter">
        <div className="text-xs font-mono text-muted mb-3 tracking-wider uppercase">Shortcut Key</div>
        <div className="mb-3">
          <label className="text-[11px] font-mono text-muted block mb-1 tracking-wider">Key</label>
          <input
            type="text"
            value={settings.hotkey}
            onChange={(e) => saveSetting("hotkey", e.target.value.toUpperCase())}
            className="w-full max-w-40 bg-elevated/50 rounded-md px-2.5 py-1.5 text-xs font-mono text-ink outline-none ring-1 ring-stroke focus:ring-accent/40 transition-all"
            placeholder="F12"
          />
        </div>
        <div>
          <label className="text-[11px] font-mono text-muted block mb-1.5 tracking-wider">Mode</label>
          <div className="flex gap-1.5">
            {[
              { id: "push-to-talk", label: "Push to Talk" },
              { id: "toggle", label: "Toggle" },
            ].map((mode) => (
              <button
                key={mode.id}
                onClick={() => saveSetting("hotkey_mode", mode.id)}
                className={`px-3 py-1.5 text-xs font-mono font-medium rounded-md transition-all duration-150 ${
                  settings.hotkey_mode === mode.id
                    ? "bg-accent/15 text-accent ring-1 ring-accent/30"
                    : "text-muted hover:text-ink hover:bg-elevated"
                }`}
              >
                {mode.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="panel-enter">
        <div className="text-xs font-mono text-muted mb-2 tracking-wider uppercase">Language</div>
        <Select
          value={settings.language}
          options={languages}
          onChange={(v) => saveSetting("language", v)}
        />
      </section>
    </div>
  );

  const renderTab = () => {
    switch (activeTab) {
      case "general": return renderGeneral();
      case "stt": return renderSTT();
      case "llm": return renderLLM();
      case "paste": return renderPaste();
      case "history": return renderHistory();
      default: return renderGeneral();
    }
  };

  return (
    <div className={`h-screen ${dark ? "dark" : "light"} bg-base text-ink flex font-sans select-none`}>
      {/* Sidebar */}
      <div className="w-44 shrink-0 bg-surface border-r border-stroke p-5 flex flex-col justify-between">
        <div>
          <div className="flex items-center gap-3 mb-8">
            <div className={`w-3 h-3 rounded-full ${appState === "recording" ? "bg-recording animate-pulse" : appState === "processing" ? "bg-warning animate-pulse" : "bg-ready"}`} />
            <div>
              <h1 className="text-base font-bold tracking-tight text-ink font-mono">v3</h1>
              <p className="text-[10px] font-mono text-muted tracking-widest uppercase">Voice</p>
            </div>
          </div>
          <nav className="space-y-1">
            {tabs.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-xs font-mono font-medium transition-all duration-150 ${
                    isActive
                      ? "bg-accent text-white"
                      : "text-muted hover:text-ink hover:bg-elevated"
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="pt-4 border-t border-stroke text-[10px] font-mono text-muted">
          v3 Dictation • v0.1.0
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Content */}
        <div className="flex-1 overflow-y-auto custom-scrollbar px-6 py-5">
          {renderTab()}
        </div>

        {/* Bottom bar */}
        <div className="flex items-center gap-3 px-6 py-2 border-t border-stroke text-[10px] font-mono text-muted">
          <span>{stats[0]} dictations</span>
          <span className="w-1 h-1 rounded-full bg-stroke" />
          <span className="capitalize">{settings.stt_mode} mode</span>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  password,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  password?: boolean;
}) {
  return (
    <div>
      <label className="text-[11px] font-mono text-muted block mb-1 tracking-wider">{label}</label>
      <input
        type={password ? "password" : "text"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-elevated/50 rounded-md px-2.5 py-1.5 text-xs font-mono text-ink placeholder:text-muted/50 outline-none ring-1 ring-stroke focus:ring-accent/50 transition-all"
        placeholder={placeholder}
      />
    </div>
  );
}

function Select({
  value,
  options,
  onChange,
  label,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);

  const selected = options.find((o) => o.value === value);

  return (
    <div>
      {label && <label className="text-[11px] font-mono text-muted block mb-1 tracking-wider">{label}</label>}
      <div className="relative w-full max-w-60">
        <button
          onClick={() => setOpen(!open)}
          onBlur={() => setOpen(false)}
          className="w-full bg-elevated/50 rounded-md px-2.5 py-1.5 text-xs font-mono text-ink text-left outline-none ring-1 ring-stroke focus:ring-accent/40 transition-all cursor-pointer flex items-center justify-between gap-2"
        >
        <span>{selected?.label ?? value}</span>
        <svg
          className={`w-3 h-3 text-muted transition-transform duration-150 ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-10 mt-1 w-full bg-elevated border border-stroke rounded-md shadow-lg max-h-48 overflow-y-auto custom-scrollbar">
          {options.map((opt) => (
            <button
              key={opt.value}
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(opt.value);
                setOpen(false);
              }}
              className={`w-full text-left px-2.5 py-1.5 text-xs font-mono transition-colors cursor-pointer ${
                value === opt.value
                  ? "bg-accent/15 text-accent"
                  : "text-muted hover:bg-elevated hover:text-ink"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
      </div>
    </div>
  );
}

export default App;