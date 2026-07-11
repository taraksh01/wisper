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
  const [agentProfiles, setAgentProfiles] = useState<AgentProfile[]>([]);
  const [vocabSuggestions, setVocabSuggestions] = useState<VocabSuggestion[]>([]);
  const [vocabScanning, setVocabScanning] = useState(false);
  const [vocabScanMsg, setVocabScanMsg] = useState("");
  const [modelsPath, setModelsPath] = useState("");
  const [modelLangFilter, setModelLangFilter] = useState("all");
  const [modelSearchQuery, setModelSearchQuery] = useState("");
  const [currentModelName, setCurrentModelName] = useState("");

  useEffect(() => {
    localStorage.setItem("wisper:active-tab", activeTab);
  }, [activeTab]);

  useEffect(() => {
    invoke<AppSettings>("load_settings").then(setSettings).catch(console.error);
    fetchHistory();
    fetchModels();
    fetchAgentProfiles();
    invoke<string>("get_models_dir_path").then(setModelsPath).catch(console.error);
    invoke<string>("get_current_state").then(setAppState).catch(console.error);
    invoke<string>("get_current_model").then(setCurrentModelName).catch(() => {});

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

  // Auto-refresh history when transcription completes
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

  const refreshCurrentModel = () => {
    invoke<string>("get_current_model").then(setCurrentModelName).catch(() => {});
  };

  const saveSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    if (!settings) return;
    const updated = { ...settings, [key]: value };
    setSettings(updated);
    console.log("[saveSetting]", key, value);
    invoke("save_settings", { settings: updated }).then(() => console.log("[saveSetting] ok")).catch(console.error);
    refreshCurrentModel();
  };

  const saveAllSettings = (updates: Partial<AppSettings>) => {
    if (!settings) return;
    const merged = { ...settings, ...updates };
    setSettings(merged);
    console.log("[saveAllSettings]", updates);
    invoke("save_settings", { settings: merged }).then(() => console.log("[saveAllSettings] ok")).catch(console.error);
    refreshCurrentModel();
  };

  const unloadModel = async () => {
    await invoke("unload_model");
    refreshCurrentModel();
  };

  const openEngineTab = () => {
    setActiveTab("stt");
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

  const renderTab = () => {
    switch (activeTab) {
      case "general":
        return <GeneralTab settings={settings} onSave={saveSetting} onReset={resetTabSettings} />;
      case "stt":
        return (
          <STTTab
            settings={settings}
            localModels={localModels}
            downloading={downloading}
            downloadProgress={downloadProgress}
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
        return <LLMTab settings={settings} profiles={agentProfiles} onSave={saveSetting} onSaveAll={saveAllSettings} onReset={resetTabSettings} />;
      case "vocab":
        return (
          <VocabTab
            settings={settings}
            onSave={saveSetting}
            onReset={resetTabSettings}
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
        return <GeneralTab settings={settings} onSave={saveSetting} onReset={resetTabSettings} />;
    }
  };

  return (
    <div className={`h-screen ${dark ? "dark" : "light"} bg-base text-ink flex font-sans select-none`}>
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
          {renderTab()}
        </div>

        <div className="flex items-center gap-3 px-6 py-2 border-t border-stroke text-[10px] font-mono text-muted">
          <span>{stats[0]} dictations</span>
          <span className="w-1 h-1 rounded-full bg-stroke" />
          <span className="capitalize">{settings.stt_mode} mode</span>
        </div>
      </div>
    </div>
  );
}

export default App;
