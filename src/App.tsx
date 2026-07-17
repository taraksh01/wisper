import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { AppSettings, HistoryEntry, AgentProfile, VocabSuggestion, tabs } from "./types";
import { Sidebar } from "./components/Sidebar";
import { GeneralTab } from "./components/GeneralTab";
import { STTTab } from "./components/STTTab";
import { LLMTab } from "./components/LLMTab";
import { VocabTab } from "./components/VocabTab";
import { HistoryTab } from "./components/HistoryTab";
import { AboutTab } from "./components/AboutTab";
import { DonateTab } from "./components/DonateTab";
import { UpdateBanner } from "./components/UpdateBanner";
import { ToastProvider, useToast } from "./components/ToastContext";
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

function Onboarding({ env, onDone }: { env: { reliable: boolean; has_wtype: boolean; has_ydotool: boolean } | null; onDone: () => void }) {
  const steps = [
    ["Speak", "Hold your hotkey and talk — release to stop."],
    ["Transcribe", "Your voice is converted to text on-device by default."],
    ["Insert", "Text is typed or pasted wherever your cursor is."],
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-base/80 backdrop-blur-sm p-4">
      <div className="bg-surface border border-stroke rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-5">
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
          <h1 className="text-sm font-bold font-mono text-ink">Welcome to Wisper</h1>
        </div>

        <ul className="space-y-2.5">
          {steps.map(([t, d]) => (
            <li key={t} className="flex items-start gap-3">
              <span className="shrink-0 mt-0.5 px-2 py-0.5 text-[10px] font-mono text-accent bg-accent/10 rounded-md">{t}</span>
              <span className="text-[11px] font-mono text-muted leading-relaxed">{d}</span>
            </li>
          ))}
        </ul>

        {env && !env.reliable && (
          <p className="text-[10px] font-mono text-recording leading-relaxed">
            On Wayland, pasting into other apps needs <span className="text-ink">wtype</span> or <span className="text-ink">ydotool</span>. Install one for reliable pasting.
          </p>
        )}

        <button
          onClick={onDone}
          className="w-full px-4 py-2.5 text-xs font-mono font-medium text-white bg-accent rounded-lg hover:bg-accent-dim transition-all"
        >
          Get started
        </button>
      </div>
    </div>
  );
}

function App() {
  const dark = useSystemTheme();
  const [activeTab, setActiveTab] = useState(() => {
    const saved = localStorage.getItem("wisper:active-tab");
    return saved && tabs.some((t) => t.id === saved) ? saved : "general";
  });
  const [appState, setAppState] = useState("idle");
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [stats, setStats] = useState<[number, number, number]>([0, 0, 0]);
  const [localModels, setLocalModels] = useState<string[]>([]);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({});
  const [justDownloaded, setJustDownloaded] = useState<string | null>(null);
  const [agentProfiles, setAgentProfiles] = useState<AgentProfile[]>([]);
  const [vocabSuggestions, setVocabSuggestions] = useState<VocabSuggestion[]>([]);
  const [vocabScanning, setVocabScanning] = useState(false);
  const [vocabScanMsg, setVocabScanMsg] = useState("");
  const [modelsPath, setModelsPath] = useState("");
  const [modelLangFilter, setModelLangFilter] = useState("all");
  const [modelSearchQuery, setModelSearchQuery] = useState("");
  const [currentModelName, setCurrentModelName] = useState("");
  const [onboarded, setOnboarded] = useState(
    () => localStorage.getItem("wisper:onboarded") === "1"
  );
  const [pasteEnv, setPasteEnv] = useState<{ reliable: boolean; has_wtype: boolean; has_ydotool: boolean } | null>(null);

  useEffect(() => {
    localStorage.setItem("wisper:active-tab", activeTab);
  }, [activeTab]);

  useEffect(() => {
    invoke<AppSettings>("load_settings").then(setSettings).catch((e) => { console.error(e); });
    fetchHistory();
    fetchModels();
    fetchAgentProfiles();
    invoke<string>("get_models_dir_path").then(setModelsPath).catch((e) => { console.error(e); });
    invoke<string>("get_current_state").then(setAppState).catch((e) => { console.error(e); });
    invoke<string>("get_current_model").then(setCurrentModelName).catch(() => {});
    invoke<{ reliable: boolean; has_wtype: boolean; has_ydotool: boolean }>("get_paste_environment")
      .then(setPasteEnv)
      .catch(() => {});

    let unlisten: UnlistenFn | undefined;
    let unlistenProgress: UnlistenFn | undefined;
    let unlistenTab: UnlistenFn | undefined;
    (async () => {
      unlisten = await listen<string>("wisper:state", (event) => {
        setAppState(event.payload);
      });
      unlistenProgress = await listen<{ model: string; progress: number }>("download-progress", (event) => {
        const { model, progress } = event.payload;
        setDownloadProgress((prev) => ({ ...prev, [model]: progress }));
      });
      unlistenTab = await listen<string>("wisper:open-tab", (event) => {
        setActiveTab(event.payload);
      });
    })();

    return () => {
      if (unlisten) unlisten();
      if (unlistenProgress) unlistenProgress();
      if (unlistenTab) unlistenTab();
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

  useEffect(() => {
    if (appState === "idle") {
      const h = invoke<HistoryEntry[]>("get_history_entries", { limit: 50 });
      const s = invoke<[number, number, number]>("get_history_stats");
      Promise.all([h, s]).then(([entries, stats]) => {
        setHistory(entries);
        setStats(stats);
      }).catch(() => {});
    }
  }, [appState]);

  const fetchModels = useCallback(async () => {
    try {
      const m = await invoke<string[]>("list_local_models");
      setLocalModels(m);
    } catch {}
  }, []);

  const fetchAgentProfiles = useCallback(async () => {
    try {
      const a = await invoke<AgentProfile[]>("get_agent_profiles");
      setAgentProfiles(a);
    } catch {}
  }, []);

  const scanVocabulary = useCallback(async () => {
    setVocabScanning(true);
    setVocabScanMsg("Reading your recent dictations…");
    setVocabSuggestions([]);
    try {
      const s = await invoke<VocabSuggestion[]>("suggest_vocabulary");
      setVocabSuggestions(s);
      if (s.length === 0) setVocabScanMsg("No new terms found in your recent dictations.");
      else setVocabScanMsg("");
    } catch (e: any) {
      setVocabScanMsg(String(e));
    } finally {
      setVocabScanning(false);
    }
  }, []);

  const downloadModel = async (name: string) => {
    setDownloading(name);
    try {
      await invoke("download_model", { modelName: name });
      await fetchModels();
      setJustDownloaded(name);
      useToast().addToast(`Downloaded ${name}`, "success");
      setTimeout(() => setJustDownloaded(null), 3000);
    } catch (e) {
      console.error("Download failed:", e);
      useToast().addToast(`Failed to download ${name}`, "error");
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

  const refreshCurrentModel = () => {
    invoke<string>("get_current_model").then(setCurrentModelName).catch(() => {});
  };

  const saveSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    if (!settings) return;
    const updated = { ...settings, [key]: value };
    setSettings(updated);
    console.log("[saveSetting]", key, value);
    invoke("save_settings", { settings: updated })
      .then(() => { console.log("[saveSetting] ok"); useToast().addToast("Settings saved", "success"); })
      .catch((e) => { console.error("[saveSetting]", e); useToast().addToast("Failed to save settings", "error"); });
    refreshCurrentModel();
  };

  const saveAllSettings = (updates: Partial<AppSettings>) => {
    if (!settings) return;
    const merged = { ...settings, ...updates };
    setSettings(merged);
    console.log("[saveAllSettings]", updates);
    invoke("save_settings", { settings: merged })
      .then(() => { console.log("[saveAllSettings] ok"); useToast().addToast("Settings saved", "success"); })
      .catch((e) => { console.error("[saveAllSettings]", e); useToast().addToast("Failed to save settings", "error"); });
    refreshCurrentModel();
  };

  const unloadModel = async () => {
    try {
      await invoke("unload_model");
      refreshCurrentModel();
    } catch (e) {
      console.error(e);
      useToast().addToast("Failed to unload model", "error");
    }
  };

  const openEngineTab = () => {
    setActiveTab("stt");
  };

  const TAB_FIELDS: Record<string, (keyof AppSettings)[]> = {
    general: ["autostart", "hotkey", "hotkey_mode", "language", "launch_to_tray", "paste_method", "paste_tool", "vad_enabled", "vad_threshold", "overlay_enabled", "overlay_position"],
    llm: ["llm_enabled", "llm_provider", "llm_base_url", "llm_api_key", "llm_api_key_openai", "llm_api_key_anthropic", "llm_api_key_google", "llm_api_key_groq", "llm_api_key_together", "llm_api_key_deepseek", "llm_api_key_kimi", "llm_api_key_qwen", "llm_api_key_glm", "llm_api_key_openrouter", "llm_api_key_ollama", "llm_api_key_custom", "llm_model", "llm_max_tokens", "llm_agent_profile", "llm_agent_name", "llm_agent_prompt"],
    vocab: ["vocabulary_enabled"],
  };

  const resetTab = async (tab: string) => {
    if (!settings) return;
    try {
      const defaults = await invoke<AppSettings>("get_default_settings");
      const fields = TAB_FIELDS[tab] ?? [];
      const merged = { ...settings };
      const defs = defaults as unknown as Record<string, unknown>;
      const target = merged as unknown as Record<string, unknown>;
      for (const f of fields) {
        target[f as string] = defs[f as string];
      }
      setSettings(merged);
      await invoke("save_settings", { settings: merged });
      useToast().addToast("Tab reset to defaults", "success");
    } catch (e) {
      console.error("Reset failed:", e);
      useToast().addToast("Failed to reset tab", "error");
    }
  };

  if (!settings) {
    return (
      <ToastProvider>
        <div className="h-screen bg-base flex items-center justify-center">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-accent animate-pulse" />
            <span className="text-sm font-mono text-muted">loading</span>
          </div>
        </div>
      </ToastProvider>
    );
  }

  const renderTab = () => {
    switch (activeTab) {
      case "general":
        return <GeneralTab settings={settings} onSave={saveSetting} onReset={() => resetTab("general")} />;
      case "stt":
        return (
          <STTTab
            settings={settings}
            localModels={localModels}
            downloading={downloading}
            downloadProgress={downloadProgress}
            justDownloaded={justDownloaded ?? undefined}
            modelsPath={modelsPath}
            modelLangFilter={modelLangFilter}
            modelSearchQuery={modelSearchQuery}
            onSave={saveSetting}
            onSaveAll={saveAllSettings}
            onDownload={downloadModel}
            onDelete={deleteLocalModel}
            onLangFilterChange={setModelLangFilter}
            onSearchQueryChange={setModelSearchQuery}
          />
        );
      case "llm":
        return <LLMTab settings={settings} profiles={agentProfiles} onSave={saveSetting} onSaveAll={saveAllSettings} onReset={() => resetTab("llm")} />;
      case "vocab":
        return (
          <VocabTab
            settings={settings}
            onSave={saveSetting}
            onReset={() => resetTab("vocab")}
            suggestions={vocabSuggestions}
            scanning={vocabScanning}
            scanMsg={vocabScanMsg}
            onScan={scanVocabulary}
            setSuggestions={setVocabSuggestions}
          />
        );
      case "history":
        return <HistoryTab history={history} stats={stats} settings={settings} onSave={saveSetting} onRefresh={fetchHistory} />;
      case "about":
        return <AboutTab />;
      case "donate":
        return <DonateTab />;
      default:
        return <GeneralTab settings={settings} onSave={saveSetting} onReset={() => resetTab("general")} />;
    }
  };

  return (
    <ToastProvider>
      <div className={`h-screen ${dark ? "dark" : "light"} bg-base text-ink flex font-sans select-none`}>
        {!onboarded && settings && (
          <Onboarding
            env={pasteEnv}
            onDone={() => {
              localStorage.setItem("wisper:onboarded", "1");
              setOnboarded(true);
            }}
          />
        )}
        <Sidebar
          activeTab={activeTab}
          appState={appState}
          settings={settings}
          currentModelName={currentModelName}
          onTabChange={setActiveTab}
          onUnloadModel={unloadModel}
          onOpenEngineTab={openEngineTab}
        />

        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 overflow-y-auto custom-scrollbar px-6 py-5">
            <UpdateBanner />
            <div key={activeTab} className="tab-enter">
              {renderTab()}
            </div>
          </div>

          <div className="flex items-center gap-3 px-6 py-2 border-t border-stroke text-[10px] font-mono text-muted">
            <span>{stats[0]} dictations</span>
            <span className="w-1 h-1 rounded-full bg-stroke" />
            <span className="capitalize">{settings.stt_mode} mode</span>
          </div>
        </div>
      </div>
    </ToastProvider>
  );
}

export default App;