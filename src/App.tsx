import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { AppSettings, HistoryEntry, SmartAgent, tabs } from "./types";
import { GeneralTab } from "./components/GeneralTab";
import { STTTab } from "./components/STTTab";
import { LLMTab } from "./components/LLMTab";
import { HistoryTab } from "./components/HistoryTab";
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
  const [activeTab, setActiveTab] = useState("general");
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

  const saveSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    if (!settings) return;
    const updated = { ...settings, [key]: value };
    setSettings(updated);
    invoke("save_settings", { settings: updated }).catch(console.error);
  };

  const saveAllSettings = (updates: Partial<AppSettings>) => {
    if (!settings) return;
    const merged = { ...settings, ...updates };
    setSettings(merged);
    invoke("save_settings", { settings: merged }).catch(console.error);
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
        return <LLMTab settings={settings} agents={agents} onSave={saveSetting} onReset={resetTabSettings} />;
      case "history":
        return <HistoryTab history={history} stats={stats} settings={settings} onSave={saveSetting} onRefresh={fetchHistory} />;
      default:
        return <GeneralTab settings={settings} onSave={saveSetting} onReset={resetTabSettings} />;
    }
  };

  return (
    <div className={`h-screen ${dark ? "dark" : "light"} bg-base text-ink flex font-sans select-none`}>
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

      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex-1 overflow-y-auto custom-scrollbar px-6 py-5">
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
