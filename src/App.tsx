import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { AppSettings, HistoryEntry, AgentProfile, tabs } from "./types";
import { Sidebar } from "./components/Sidebar";
import { GeneralTab } from "./components/GeneralTab";
import { EngineTab } from "./components/EngineTab";
import { ProcessTab } from "./components/ProcessTab";
import { WordsTab } from "./components/WordsTab";
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

function AppShell() {
  const dark = useSystemTheme();
  const [activeTab, setActiveTab] = useState(() => {
    const saved = localStorage.getItem("wisper:active-tab");
    return saved && tabs.some((t) => t.id === saved) ? saved : "general";
  });
  const [appState, setAppState] = useState("idle");
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [stats, setStats] = useState<[number, number, number]>([0, 0, 0]);
  const [agentProfiles, setAgentProfiles] = useState<AgentProfile[]>([]);
  const [currentModelName, setCurrentModelName] = useState("");
  const [onboarded, setOnboarded] = useState(
    () => localStorage.getItem("wisper:onboarded") === "1"
  );
  const [pasteEnv, setPasteEnv] = useState<{ reliable: boolean; has_wtype: boolean; has_ydotool: boolean } | null>(null);

  const toast = useToast();

  useEffect(() => {
    localStorage.setItem("wisper:active-tab", activeTab);
  }, [activeTab]);

  useEffect(() => {
    invoke<AppSettings>("load_settings").then(setSettings).catch((e) => { console.error(e); });
    fetchHistory();
    fetchAgentProfiles();
    invoke<string>("get_current_state").then(setAppState).catch((e) => { console.error(e); });
    invoke<string>("get_current_model").then(setCurrentModelName).catch(() => {});
    invoke<{ reliable: boolean; has_wtype: boolean; has_ydotool: boolean }>("get_paste_environment")
      .then(setPasteEnv)
      .catch(() => {});

    let unlisten: UnlistenFn | undefined;
    let unlistenTab: UnlistenFn | undefined;
    (async () => {
      unlisten = await listen<string>("wisper:state", (event) => {
        setAppState(event.payload);
      });
      unlistenTab = await listen<string>("wisper:open-tab", (event) => {
        setActiveTab(event.payload);
      });
    })();

    return () => {
      if (unlisten) unlisten();
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
      const settings = invoke<AppSettings>("load_settings");
      Promise.all([h, s, settings]).then(([entries, stats, st]) => {
        setHistory(entries);
        setStats(stats);
        setSettings(st);
      }).catch(() => {});
    }
  }, [appState]);

  const fetchAgentProfiles = useCallback(async () => {
    try {
      const a = await invoke<AgentProfile[]>("get_agent_profiles");
      setAgentProfiles(a);
    } catch {}
  }, []);

  const refreshCurrentModel = () => {
    invoke<string>("get_current_model").then(setCurrentModelName).catch(() => {});
  };

  const saveSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    if (!settings) return;
    const updated = { ...settings, [key]: value };
    setSettings(updated);
    console.log("[saveSetting]", key, value);
    const msg = settingToast(key, value);
    invoke("save_settings", { settings: updated })
      .then(() => { if (msg) toast.addToast(msg, "success"); })
      .catch((e) => { console.error("[saveSetting]", e); toast.addToast("Failed to save settings", "error"); });
    refreshCurrentModel();
  };

  const saveAllSettings = (updates: Partial<AppSettings>) => {
    if (!settings) return;
    const merged = { ...settings, ...updates };
    setSettings(merged);
    console.log("[saveAllSettings]", updates);
    invoke("save_settings", { settings: merged })
      .then(() => { toast.addToast("Settings saved", "success"); })
      .catch((e) => { console.error("[saveAllSettings]", e); toast.addToast("Failed to save settings", "error"); });
    refreshCurrentModel();
  };

  const settingToast = <K extends keyof AppSettings>(key: K, value: AppSettings[K]): string | null => {
    const on = (v: boolean) => (v ? "enabled" : "disabled");
    switch (key) {
      case "autostart": return `Launch at login ${on(Boolean(value))}`;
      case "launch_to_tray": return Boolean(value) ? "Opens to system tray" : "Opens to full window";
      case "language": return "Display language updated";
      case "paste_method": return `Paste method: ${String(value)}`;
      case "vad_enabled": return `Silence trimming ${on(Boolean(value))}`;
      case "keep_recordings": return `Keep recordings ${on(Boolean(value))}`;
      case "overlay_enabled": return `Recording overlay ${on(Boolean(value))}`;
      case "overlay_position": return `Overlay position: ${String(value)}`;
      case "hotkey": return `Shortcut: ${String(value)}`;
      case "hotkey_mode": return `Mode: ${String(value)}`;
      case "paste_tool": return `Paste tool: ${String(value)}`;
      case "input_device": return value ? `Microphone: ${String(value)}` : "Microphone: System default";
      case "process_enabled": return `AI processing ${on(Boolean(value))}`;
      case "words_enabled": return `Custom words ${on(Boolean(value))}`;
      case "local_model_file": return "Local model changed";
      case "engine_mode": return `Engine: ${String(value)}`;
      default: return null;
    }
  };

  const unloadModel = async () => {
    try {
      await invoke("unload_model");
      refreshCurrentModel();
    } catch (e) {
      console.error(e);
      toast.addToast("Failed to unload model", "error");
    }
  };

  const openEngineTab = () => {
    setActiveTab("engine");
  };

  const TAB_FIELDS: Record<string, (keyof AppSettings)[]> = {
    general: ["autostart", "hotkey", "hotkey_mode", "language", "launch_to_tray", "paste_method", "paste_tool", "vad_enabled", "vad_threshold", "overlay_enabled", "overlay_position", "input_device"],
    engine: ["engine_mode", "engine_model", "local_model_file"],
    process: ["process_enabled", "process_provider", "process_base_url", "process_api_key", "process_api_key_openai", "process_api_key_anthropic", "process_api_key_google", "process_api_key_groq", "process_api_key_together", "process_api_key_deepseek", "process_api_key_kimi", "process_api_key_qwen", "process_api_key_glm", "process_api_key_openrouter", "process_api_key_ollama", "process_api_key_custom", "process_model", "process_max_tokens", "process_agent_profile", "process_agent_name", "process_agent_prompt"],
    words: ["words_enabled"],
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
      toast.addToast("Tab reset to defaults", "success");
    } catch (e) {
      console.error("Reset failed:", e);
      toast.addToast("Failed to reset tab", "error");
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
        return <GeneralTab settings={settings} onSave={saveSetting} onReset={() => resetTab("general")} />;
      case "engine":
        return (
          <EngineTab
            settings={settings}
            onSave={saveSetting}
            onSaveAll={saveAllSettings}
          />
        );
      case "process":
        return <ProcessTab settings={settings} profiles={agentProfiles} onSave={saveSetting} onSaveAll={saveAllSettings} onReset={() => resetTab("process")} />;
      case "words":
        return (
          <WordsTab
            settings={settings}
            onSave={saveSetting}
            onReset={() => resetTab("words")}
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
            <span className="capitalize">{settings.engine_mode} mode</span>
          </div>
        </div>
      </div>
  );
}

// App wraps the shell in a single ToastProvider so useToast() is valid app-wide.

export default function App() {
  return (
    <ToastProvider>
      <AppShell />
    </ToastProvider>
  );
}