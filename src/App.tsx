import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import "./App.css";
import "./styles.css";

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
}

const tabs = [
  { id: "stt", label: "STT Engine" },
  { id: "llm", label: "LLM Processing" },
  { id: "hotkeys", label: "Hotkeys" },
  { id: "paste", label: "Paste Engine" },
  { id: "history", label: "History" },
];

function App() {
  const [activeTab, setActiveTab] = useState("stt");

  // State
  const [appState, setAppState] = useState("idle");

  // Settings
  const [settings, setSettings] = useState<AppSettings | null>(null);

  // History
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [stats, setStats] = useState<[number, number, number]>([0, 0, 0]);

  // Models
  const [localModels, setLocalModels] = useState<string[]>([]);
  const [downloading, setDownloading] = useState<string | null>(null);

  // Agents
  const [agents, setAgents] = useState<SmartAgent[]>([]);

  // Load settings on mount
  useEffect(() => {
    invoke<AppSettings>("load_settings").then(setSettings).catch(console.error);
    fetchHistory();
    fetchModels();
    fetchAgents();
    invoke<string>("get_current_state").then(setAppState).catch(console.error);

    // Listen for state changes from backend
    let unlisten: UnlistenFn | undefined;
    (async () => {
      unlisten = await listen<string>("v3:state", (event) => {
        setAppState(event.payload);
      });
    })();

    return () => {
      if (unlisten) unlisten();
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
  };

  const saveSetting = (key: keyof AppSettings, value: any) => {
    if (!settings) return;
    const updated = { ...settings, [key]: value };
    setSettings(updated);
    invoke("save_settings", { settings: updated }).catch(console.error);
  };

  if (!settings) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <p className="text-neutral-400">Loading settings...</p>
      </div>
    );
  }

  const StateIndicator = () => {
    const colors: Record<string, string> = {
      idle: "bg-green-500",
      recording: "bg-red-500 animate-pulse",
      processing: "bg-yellow-500 animate-pulse",
    };
    const labels: Record<string, string> = {
      idle: "Ready",
      recording: "Recording...",
      processing: "Processing...",
    };
    return (
      <div className="flex items-center gap-2 mb-6 bg-neutral-900/80 border border-neutral-800 rounded-xl px-4 py-3">
        <span className={`w-3 h-3 rounded-full ${colors[appState] || "bg-green-500"}`} />
        <span className="text-sm text-neutral-300 font-medium">{labels[appState] || "Ready"}</span>
        <span className="text-xs text-neutral-500 ml-auto">Press F12 to dictate</span>
      </div>
    );
  };

  const renderSTT = () => (
    <div className="space-y-6">
      <StateIndicator />

      <div className="bg-neutral-900/60 border border-neutral-800 rounded-xl p-6 shadow-xl">
        <h3 className="text-lg font-medium text-white mb-4">Mode</h3>
        <div className="flex gap-2">
          {["local", "cloud"].map((mode) => (
            <button
              key={mode}
              onClick={() => saveSetting("stt_mode", mode)}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                settings.stt_mode === mode
                  ? "bg-orange-600 text-white shadow-lg shadow-orange-600/20"
                  : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700"
              }`}
            >
              {mode === "local" ? "Local (Whisper)" : "Cloud API"}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-neutral-900/60 border border-neutral-800 rounded-xl p-6 shadow-xl">
        <h3 className="text-lg font-medium text-white mb-4">
          {settings.stt_mode === "local" ? "Local Model" : "Cloud STT API"}
        </h3>

        {settings.stt_mode === "local" ? (
          <>
            <p className="text-neutral-400 text-sm mb-4">
              Download a Whisper model for fully offline transcription.
            </p>
            <div className="flex flex-wrap gap-2 mb-4">
              {["tiny.en", "base.en", "small.en"].map((name) => (
                <button
                  key={name}
                  onClick={() => downloadModel(name)}
                  disabled={downloading === name}
                  className="px-4 py-2 bg-orange-600 hover:bg-orange-500 disabled:bg-neutral-700 disabled:text-neutral-500 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  {downloading === name ? "Downloading..." : `Download ${name}`}
                </button>
              ))}
            </div>
            <div>
              <h4 className="text-sm text-neutral-300 font-medium mb-2">Available Models</h4>
              {localModels.length === 0 ? (
                <p className="text-neutral-500 text-sm">No models downloaded yet.</p>
              ) : (
                <div className="space-y-1">
                  {localModels.map((m) => (
                    <label
                      key={m}
                      onClick={() => saveSetting("local_model_file", m)}
                      className={`flex items-center gap-2 px-3 py-2 text-sm rounded-lg cursor-pointer transition-colors ${
                        settings.local_model_file === m
                          ? "bg-orange-600/20 text-orange-400 border border-orange-600/40"
                          : "text-neutral-400 hover:bg-neutral-800 border border-transparent"
                      }`}
                    >
                      <input
                        type="radio"
                        name="model"
                        checked={settings.local_model_file === m}
                        onChange={() => {}}
                        className="accent-orange-500"
                      />
                      {m}
                    </label>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="text-sm text-neutral-400 block mb-1">Base URL</label>
              <input
                type="text"
                value={settings.stt_base_url}
                onChange={(e) => saveSetting("stt_base_url", e.target.value)}
                className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-orange-500"
                placeholder="https://api.openai.com/v1"
              />
            </div>
            <div>
              <label className="text-sm text-neutral-400 block mb-1">API Key</label>
              <input
                type="password"
                value={settings.stt_api_key}
                onChange={(e) => saveSetting("stt_api_key", e.target.value)}
                className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-orange-500"
                placeholder="sk-..."
              />
            </div>
            <div>
              <label className="text-sm text-neutral-400 block mb-1">Model</label>
              <input
                type="text"
                value={settings.stt_model}
                onChange={(e) => saveSetting("stt_model", e.target.value)}
                className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-orange-500"
                placeholder="whisper-1"
              />
            </div>
          </div>
        )}
      </div>

      <div className="bg-neutral-900/60 border border-neutral-800 rounded-xl p-6 shadow-xl">
        <h3 className="text-lg font-medium text-white mb-4">Voice Activity Detection</h3>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.vad_enabled}
            onChange={(e) => saveSetting("vad_enabled", e.target.checked)}
            className="accent-orange-500"
          />
          <span className="text-sm text-neutral-300">Trim silence from recordings</span>
        </label>
      </div>
    </div>
  );

  const renderLLM = () => (
    <div className="space-y-6">
      <div className="bg-neutral-900/60 border border-neutral-800 rounded-xl p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium text-white">LLM Post-Processing</h3>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.llm_enabled}
              onChange={(e) => saveSetting("llm_enabled", e.target.checked)}
              className="accent-orange-500"
            />
            <span className="text-sm text-neutral-400">Enabled</span>
          </label>
        </div>

        {settings.llm_enabled && (
          <div className="space-y-3">
            <div>
              <label className="text-sm text-neutral-400 block mb-1">Base URL</label>
              <input
                type="text"
                value={settings.llm_base_url}
                onChange={(e) => saveSetting("llm_base_url", e.target.value)}
                className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
                placeholder="http://localhost:11434/v1"
              />
            </div>
            <div>
              <label className="text-sm text-neutral-400 block mb-1">API Key</label>
              <input
                type="password"
                value={settings.llm_api_key}
                onChange={(e) => saveSetting("llm_api_key", e.target.value)}
                className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
                placeholder="sk-..."
              />
            </div>
            <div>
              <label className="text-sm text-neutral-400 block mb-1">Model</label>
              <input
                type="text"
                value={settings.llm_model}
                onChange={(e) => saveSetting("llm_model", e.target.value)}
                className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
                placeholder="llama3.2"
              />
            </div>
          </div>
        )}
      </div>

      {settings.llm_enabled && (
        <div className="bg-neutral-900/60 border border-neutral-800 rounded-xl p-6 shadow-xl">
          <h3 className="text-lg font-medium text-white mb-4">Smart Agent Profiles</h3>
          {agents.map((agent) => (
            <div key={agent.name} className="mb-4 last:mb-0">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-2 h-2 rounded-full bg-orange-500" />
                <span className="text-sm font-medium text-white">{agent.name}</span>
                {agent.active && (
                  <span className="text-xs bg-orange-600/20 text-orange-400 px-2 py-0.5 rounded-full">
                    Active
                  </span>
                )}
              </div>
              <textarea
                readOnly
                value={agent.system_prompt}
                className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-300 h-24 resize-none"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderHotkeys = () => (
    <div className="bg-neutral-900/60 border border-neutral-800 rounded-xl p-6 shadow-xl">
      <h3 className="text-lg font-medium text-white mb-4">Global Hotkeys</h3>
      <div className="space-y-4">
        <div>
          <label className="text-sm text-neutral-400 block mb-1">Hotkey</label>
          <input
            type="text"
            value={settings.hotkey}
            onChange={(e) => saveSetting("hotkey", e.target.value.toUpperCase())}
            className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2.5 text-sm text-white font-mono focus:outline-none focus:border-orange-500"
            placeholder="F12"
          />
        </div>
        <div>
          <label className="text-sm text-neutral-400 block mb-1">Mode</label>
          <div className="flex gap-2">
            {[
              { id: "push-to-talk", label: "Push-to-Talk (Hold)" },
              { id: "toggle", label: "Toggle (Tap)" },
            ].map((mode) => (
              <button
                key={mode.id}
                onClick={() => saveSetting("hotkey_mode", mode.id)}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                  settings.hotkey_mode === mode.id
                    ? "bg-orange-600 text-white"
                    : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700"
                }`}
              >
                {mode.label}
              </button>
            ))}
          </div>
        </div>
        <p className="text-xs text-neutral-500">
          {settings.hotkey_mode === "push-to-talk"
            ? `Hold ${settings.hotkey} to record, release to transcribe and paste.`
            : `Press ${settings.hotkey} to start recording, press again to stop.`}
        </p>
      </div>
    </div>
  );

  const renderPaste = () => (
    <div className="bg-neutral-900/60 border border-neutral-800 rounded-xl p-6 shadow-xl">
      <h3 className="text-lg font-medium text-white mb-4">Paste Method</h3>
      <div className="flex flex-wrap gap-2 mb-6">
        {["Ctrl+V", "Ctrl+Shift+V", "Shift+Insert", "Direct Typing"].map((method) => (
          <button
            key={method}
            onClick={() => saveSetting("paste_method", method)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              settings.paste_method === method
                ? "bg-orange-600 text-white"
                : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700"
            }`}
          >
            {method}
          </button>
        ))}
      </div>
      <div className="text-neutral-500 text-xs">
        Display server: <span className="text-orange-400">Auto-detected</span>
      </div>
    </div>
  );

  const renderHistory = () => (
    <div className="space-y-6">
      <StateIndicator />

      <div className="bg-neutral-900/60 border border-neutral-800 rounded-xl p-6 shadow-xl">
        <h3 className="text-lg font-medium text-white mb-4">Usage Analytics</h3>
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-neutral-800/60 rounded-lg p-4 text-center">
            <div className="text-2xl font-bold text-orange-500">{stats[0]}</div>
            <div className="text-xs text-neutral-400 mt-1">Dictations</div>
          </div>
          <div className="bg-neutral-800/60 rounded-lg p-4 text-center">
            <div className="text-2xl font-bold text-orange-500">{stats[1]}</div>
            <div className="text-xs text-neutral-400 mt-1">Total Words</div>
          </div>
          <div className="bg-neutral-800/60 rounded-lg p-4 text-center">
            <div className="text-2xl font-bold text-orange-500">{stats[2].toFixed(1)}</div>
            <div className="text-xs text-neutral-400 mt-1">Avg Words/Dictation</div>
          </div>
        </div>
      </div>

      <div className="bg-neutral-900/60 border border-neutral-800 rounded-xl p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium text-white">Recent Transcriptions</h3>
          <button
            onClick={fetchHistory}
            className="text-xs text-orange-400 hover:text-orange-300 transition-colors"
          >
            Refresh
          </button>
        </div>
        {history.length === 0 ? (
          <p className="text-neutral-500 text-sm">No history yet. Press {settings.hotkey} to dictate!</p>
        ) : (
          <div className="space-y-3 max-h-96 overflow-y-auto custom-scrollbar">
            {history.map((entry) => (
              <div
                key={entry.id}
                className="bg-neutral-800/40 border border-neutral-700/50 rounded-lg p-3 hover:border-neutral-600 transition-colors"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-neutral-500">{entry.created_at}</span>
                  <span className="text-xs text-neutral-500">{entry.word_count} words</span>
                </div>
                <p
                  className="text-sm text-neutral-200 cursor-pointer hover:text-orange-400 transition-colors"
                  onClick={() => navigator.clipboard.writeText(entry.formatted_text || entry.raw_text)}
                  title="Click to copy"
                >
                  {entry.formatted_text || entry.raw_text}
                </p>
                {entry.agent_name && (
                  <span className="text-xs text-orange-500/70 mt-1 block">via {entry.agent_name}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  const renderTab = () => {
    switch (activeTab) {
      case "stt":
        return renderSTT();
      case "llm":
        return renderLLM();
      case "hotkeys":
        return renderHotkeys();
      case "paste":
        return renderPaste();
      case "history":
        return renderHistory();
      default:
        return renderSTT();
    }
  };

  return (
    <div className="min-h-screen bg-black text-neutral-100 flex font-sans">
      <div className="w-64 bg-neutral-950 border-r border-neutral-800 p-5 flex flex-col justify-between">
        <div>
          <div className="flex items-center gap-3 mb-8">
            <div className="w-3 h-3 rounded-full bg-orange-500 shadow-[0_0_12px_rgba(249,115,22,0.8)]" />
            <h1 className="text-xl font-bold tracking-tight text-white">
              v3{" "}
              <span className="text-xs font-normal text-orange-500 uppercase tracking-widest ml-1">
                Voice
              </span>
            </h1>
          </div>
          <nav className="space-y-1.5">
            {tabs.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`w-full text-left px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${
                    isActive
                      ? "bg-orange-600 text-white shadow-lg shadow-orange-600/20"
                      : "text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200"
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="pt-4 border-t border-neutral-900 text-xs text-neutral-500">
          v3 Dictation • v0.1.0
        </div>
      </div>

      <div className="flex-1 p-8 bg-neutral-950/50 overflow-y-auto" style={{ width: "100%" }}>
        <header className="mb-8 border-b border-neutral-900 pb-4">
          <h2 className="text-2xl font-semibold text-white tracking-tight capitalize">
            {tabs.find((t) => t.id === activeTab)?.label}
          </h2>
          <p className="text-sm text-neutral-400 mt-1">
            Configure {tabs.find((t) => t.id === activeTab)?.label.toLowerCase()} settings.
          </p>
        </header>

        {renderTab()}
      </div>
    </div>
  );
}

export default App;