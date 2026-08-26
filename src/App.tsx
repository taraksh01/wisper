import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AppSettings, HistoryEntry, AgentProfile, tabs } from "./types";
import { Sidebar } from "./components/Sidebar";
import { Onboarding } from "./components/Onboarding";
import { GeneralTab } from "./components/GeneralTab";
import { EngineTab } from "./components/EngineTab";
import { ProcessTab } from "./components/ProcessTab";
import { WordsTab } from "./components/WordsTab";
import { HistoryTab } from "./components/HistoryTab";
import { AboutTab } from "./components/AboutTab";
import { DonateTab } from "./components/DonateTab";
import { UpdateBanner } from "./components/UpdateBanner";
import { ToastProvider, useToast } from "./components/ToastContext";
import { storageKey } from "./appConfig";
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
  // Sync theme class onto <html> so portaled elements (Select dropdown,
  // ConfirmModal, toasts) inherit the correct CSS variables.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", dark);
    root.classList.toggle("light", !dark);
    return () => {
      root.classList.remove("dark", "light");
    };
  }, [dark]);
  return dark;
}

function safeStorageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeStorageSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable (private mode) */
  }
}

function AppShell() {
  const dark = useSystemTheme();
  const [activeTab, setActiveTab] = useState(() => {
    const saved = safeStorageGet(storageKey("active-tab"));
    return saved && tabs.some((t) => t.id === saved) ? saved : "general";
  });
  const [appState, setAppState] = useState("idle");
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [stats, setStats] = useState<[number, number, number]>([0, 0, 0]);
  const [agentProfiles, setAgentProfiles] = useState<AgentProfile[]>([]);
  const [currentModelName, setCurrentModelName] = useState("");
  const [onboarded, setOnboarded] = useState(
    () => safeStorageGet(storageKey("onboarded")) === "1"
  );
  const [pasteEnv, setPasteEnv] = useState<{ reliable: boolean; has_wtype: boolean; has_ydotool: boolean } | null>(null);

  const toast = useToast();

  useEffect(() => {
    safeStorageSet(storageKey("active-tab"), activeTab);
  }, [activeTab]);

  useEffect(() => {
    let alive = true;
    invoke<AppSettings>("load_settings").then((v) => alive && setSettings(v)).catch((e) => { console.error(e); });
    fetchHistory();
    fetchAgentProfiles();
    invoke<string>("get_current_state").then((v) => alive && setAppState(v)).catch((e) => { console.error(e); });
    invoke<string>("get_current_model").then((v) => alive && setCurrentModelName(v)).catch(() => {});
    invoke<{ reliable: boolean; has_wtype: boolean; has_ydotool: boolean }>("get_paste_environment", { preference: "auto" })
      .then((v) => alive && setPasteEnv(v))
      .catch(() => {});

    const unlistenStatePromise = listen<string>("wisper:state", (event) => {
      if (alive) setAppState(event.payload);
    });
    const unlistenTabPromise = listen<string>("wisper:open-tab", (event) => {
      if (alive) setActiveTab(event.payload);
    });
    const unlistenSettingsPromise = listen<AppSettings>("wisper:settings-changed", (event) => {
      if (alive) {
        setSettings(event.payload);
        // Single source: settings.local_model_file — refresh display name
        if (!event.payload.local_model_file) {
          setCurrentModelName("");
        } else {
          invoke<string>("get_current_model").then((v) => alive && setCurrentModelName(v)).catch(() => {});
        }
      }
    });

    return () => {
      alive = false;
      unlistenStatePromise.then((fn) => fn()).catch(() => {});
      unlistenTabPromise.then((fn) => fn()).catch(() => {});
      unlistenSettingsPromise.then((fn) => fn()).catch(() => {});
    };
  }, []);

  const PAGE_SIZE = 50;

  const fetchHistory = useCallback(async () => {
    try {
      const [h, s, c] = await Promise.all([
        invoke<HistoryEntry[]>("get_history_entries", { limit: PAGE_SIZE, offset: 0 }),
        invoke<[number, number, number]>("get_history_stats"),
        invoke<number>("get_history_count"),
      ]);
      setHistory(h);
      setStats(s);
      setHistoryTotal(c);
    } catch {}
  }, []);

  const loadOlder = useCallback(async () => {
    if (loadingOlder || history.length >= historyTotal) return;
    setLoadingOlder(true);
    try {
      const older = await invoke<HistoryEntry[]>("get_history_entries", {
        limit: PAGE_SIZE,
        offset: history.length,
      });
      setHistory((prev) => [...prev, ...older]);
    } catch {}
    setLoadingOlder(false);
  }, [history.length, historyTotal, loadingOlder]);

  const hasMounted = useRef(false);
  useEffect(() => {
    if (!hasMounted.current) {
      hasMounted.current = true;
      return;
    }
    if (appState === "idle") {
      const h = invoke<HistoryEntry[]>("get_history_entries", { limit: PAGE_SIZE, offset: 0 });
      const s = invoke<[number, number, number]>("get_history_stats");
      const c = invoke<number>("get_history_count");
      const settingsReq = invoke<AppSettings>("load_settings");
      Promise.all([h, s, c, settingsReq]).then(([entries, st, count, stt]) => {
        setHistory(entries);
        setStats(st);
        setHistoryTotal(count);
        setSettings(stt);
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

  const MODEL_KEYS: (keyof AppSettings)[] = ["engine_mode", "engine_provider", "engine_base_url", "voice_api_key", "voice_api_key_openai", "voice_api_key_groq", "voice_api_key_custom", "engine_model", "local_model_file"];
  const saveSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    if (!settings) return;
    const prev = { ...settings };
    const updated = { ...settings, [key]: value };
    setSettings(updated);
    const msg = settingToast(key, value);
    invoke<number>("save_settings", { settings: updated })
      .then((trimmed) => {
        if (key === "max_history_entries" || key === "history_retention_mode") {
          fetchHistory();
          if (typeof trimmed === "number" && trimmed > 0) {
            toast.addToast(`Trimmed ${trimmed} oldest entries`, "success");
          } else {
            if (msg) toast.addToast(msg, "success");
            else toast.addToast("History limit updated", "success");
          }
        } else {
          if (msg) toast.addToast(msg, "success");
        }
      })
      .catch((e) => { console.error("[saveSetting]", e); setSettings(prev); toast.addToast("Failed to save settings", "error"); });
    if ((MODEL_KEYS as string[]).includes(key as string)) refreshCurrentModel();
  };

  const saveAllSettings = (updates: Partial<AppSettings>) => {
    if (!settings) return;
    const prev = { ...settings };
    const merged = { ...settings, ...updates };
    setSettings(merged);
    invoke("save_settings", { settings: merged })
      .then(() => { toast.addToast("Settings saved", "success"); })
      .catch((e) => { console.error("[saveAllSettings]", e); setSettings(prev); toast.addToast("Failed to save settings", "error"); });
    if (Object.keys(updates).some((k) => (MODEL_KEYS as string[]).includes(k))) refreshCurrentModel();
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
      case "sound_enabled": return `Sound feedback ${on(Boolean(value))}`;
      case "sound_on_start": return `Sound on start ${on(Boolean(value))}`;
      case "sound_on_done": return `Sound when done ${on(Boolean(value))}`;
      case "sound_on_cancel": return `Sound on cancel ${on(Boolean(value))}`;
      case "sound_on_error": return `Sound on error ${on(Boolean(value))}`;
      case "hotkey": return null; // handled inline in GeneralTab to avoid double toast + to allow rollback on failure
      case "hotkey_mode": return `Mode: ${String(value)}`;
      case "paste_tool": return `Paste tool: ${String(value)}`;
      case "input_device": return value ? `Microphone: ${String(value)}` : "Microphone: System default";
      case "process_enabled": return `AI processing ${on(Boolean(value))}`;
      case "words_enabled": return `Your dictionary ${on(Boolean(value))}`;
      case "local_model_file": return "Local model changed";
      case "engine_mode": return `Engine: ${String(value)}`;
      case "max_history_entries": return value === 0 ? "History: unlimited" : `History limit: ${String(value)} entries`;
      case "history_retention_mode": return String(value) === "both" ? "Retention: delete both" : "Retention: keep transcripts";
      default: return null;
    }
  };

  const unloadModel = async () => {
    try {
      await invoke("unload_model");
      // Single source is settings.local_model_file — clear it locally too
      setSettings((prev) => (prev ? { ...prev, local_model_file: "" } : prev));
      setCurrentModelName("");
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
    general: ["autostart", "hotkey", "hotkey_mode", "language", "launch_to_tray", "paste_method", "paste_tool", "vad_enabled", "vad_threshold", "noise_suppression_enabled", "noise_suppression_level", "overlay_enabled", "overlay_position", "sound_enabled", "sound_on_start", "sound_on_done", "sound_on_cancel", "sound_on_error", "input_device", "max_history_entries", "history_retention_mode", "keep_recordings"],
    engine: ["engine_mode", "engine_provider", "engine_base_url", "voice_api_key", "voice_api_key_openai", "voice_api_key_groq", "voice_api_key_custom", "engine_model", "local_model_file"],
    process: ["process_enabled", "process_provider", "process_base_url", "process_endpoint", "process_timeout_secs", "process_api_key", "process_api_key_openai", "process_api_key_anthropic", "process_api_key_google", "process_api_key_groq", "process_api_key_together", "process_api_key_deepseek", "process_api_key_kimi", "process_api_key_qwen", "process_api_key_glm", "process_api_key_openrouter", "process_api_key_ollama", "process_api_key_opencode_go", "process_api_key_custom", "process_model", "process_max_tokens", "process_agent_profile", "process_agent_name", "process_agent_prompt"],
    words: ["words_enabled", "words_auto_scan"],
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
        return <GeneralTab settings={settings} historyTotal={historyTotal} onSave={saveSetting} onReset={() => resetTab("general")} />;
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
        return <HistoryTab history={history} stats={stats} settings={settings} historyTotal={historyTotal} loadingOlder={loadingOlder} onLoadOlder={loadOlder} onSave={saveSetting} onRefresh={fetchHistory} />;
      case "about":
        return <AboutTab />;
      case "donate":
        return <DonateTab />;
      default:
        return <GeneralTab settings={settings} historyTotal={historyTotal} onSave={saveSetting} onReset={() => resetTab("general")} />;
    }
  };

  return (
    <div className={`h-screen ${dark ? "dark" : "light"} app-canvas text-ink flex font-sans selection:bg-accent/20`}>
        {!onboarded && settings && (
          <Onboarding
            env={pasteEnv}
            onDone={() => {
              localStorage.setItem(storageKey("onboarded"), "1");
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
          <div className="flex-1 overflow-y-auto custom-scrollbar">
            <div className="max-w-[var(--content-max)] mx-auto w-full px-6 py-6">
              <UpdateBanner />
              <div className="tab-enter">
                {renderTab()}
              </div>
            </div>
          </div>

          <div className="shrink-0 px-6 py-3 border-t border-stroke/80 bg-surface/60 backdrop-blur-[6px] flex items-center gap-2.5 text-[11px] font-mono">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-elevated border border-stroke text-muted">
              <span className="w-1.5 h-1.5 rounded-full bg-ink/20" />
              {stats[0]} dictations
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-accent-soft border border-accent/15 text-ink/80 capitalize">
              <span className="w-1.5 h-1.5 rounded-full bg-accent" />
              {settings.engine_mode}
            </span>
            <span className="ml-auto text-muted/50 text-[10px] tracking-widest uppercase hidden sm:inline">private · on-device</span>
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