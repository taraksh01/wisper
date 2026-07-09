import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

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

const tabs = [
  { id: "stt", label: "STT Engine" },
  { id: "llm", label: "LLM Processing" },
  { id: "hotkeys", label: "Hotkeys" },
  { id: "paste", label: "Paste Engine" },
  { id: "history", label: "History" },
];

function App() {
  const [activeTab, setActiveTab] = useState("stt");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [stats, setStats] = useState<[number, number, number]>([0, 0, 0]);
  const [agents, setAgents] = useState<SmartAgent[]>([]);
  const [localModels, setLocalModels] = useState<string[]>([]);

  const fetchHistory = useCallback(async () => {
    try {
      const h = await invoke<HistoryEntry[]>("get_history_entries", { limit: 50 });
      setHistory(h);
      const s = await invoke<[number, number, number]>("get_history_stats");
      setStats(s);
    } catch (e) {
      console.error("Failed to fetch history:", e);
    }
  }, []);

  const fetchModels = useCallback(async () => {
    try {
      const m = await invoke<string[]>("list_local_models");
      setLocalModels(m);
    } catch (e) {
      console.error("Failed to list models:", e);
    }
  }, []);

  const fetchAgents = useCallback(async () => {
    try {
      const a = await invoke<SmartAgent[]>("get_default_agents");
      setAgents(a);
    } catch (e) {
      console.error("Failed to fetch agents:", e);
    }
  }, []);

  useEffect(() => {
    fetchHistory();
    fetchModels();
    fetchAgents();
  }, []);

  const downloadModel = async (name: string) => {
    try {
      await invoke("download_model", { modelName: name });
      fetchModels();
    } catch (e) {
      console.error("Download failed:", e);
    }
  };

  const renderSTT = () => (
    <div className="space-y-6">
      <div className="bg-neutral-900/60 border border-neutral-800 rounded-xl p-6 shadow-xl">
        <h3 className="text-lg font-medium text-white mb-4">Local Model</h3>
        <p className="text-neutral-400 text-sm mb-4">
          Download a Whisper model for fully offline transcription.
        </p>
        <div className="flex flex-wrap gap-2 mb-4">
          {["tiny.en", "base.en", "small.en"].map((name) => (
            <button
              key={name}
              onClick={() => downloadModel(name)}
              className="px-4 py-2 bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Download {name}
            </button>
          ))}
        </div>
        <div>
          <h4 className="text-sm text-neutral-300 font-medium mb-2">Available Models</h4>
          {localModels.length === 0 ? (
            <p className="text-neutral-500 text-sm">No models downloaded yet.</p>
          ) : (
            <ul className="space-y-1">
              {localModels.map((m) => (
                <li key={m} className="text-sm text-neutral-400 flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-orange-500" />
                  {m}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div className="bg-neutral-900/60 border border-neutral-800 rounded-xl p-6 shadow-xl">
        <h3 className="text-lg font-medium text-white mb-3">Cloud STT API</h3>
        <p className="text-neutral-400 text-sm">
          Base URL: <code className="text-orange-400">Coming soon</code>
        </p>
      </div>
    </div>
  );

  const renderLLM = () => (
    <div className="space-y-6">
      <div className="bg-neutral-900/60 border border-neutral-800 rounded-xl p-6 shadow-xl">
        <h3 className="text-lg font-medium text-white mb-4">LLM Provider</h3>
        <div className="space-y-3">
          <div>
            <label className="text-sm text-neutral-400 block mb-1">Base URL</label>
            <input
              type="text"
              defaultValue="http://localhost:11434/v1"
              className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-orange-500"
              placeholder="https://api.openai.com/v1"
            />
          </div>
          <div>
            <label className="text-sm text-neutral-400 block mb-1">API Key</label>
            <input
              type="password"
              className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-orange-500"
              placeholder="sk-..."
            />
          </div>
          <div>
            <label className="text-sm text-neutral-400 block mb-1">Model</label>
            <input
              type="text"
              defaultValue="llama3.2"
              className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-orange-500"
              placeholder="gpt-4o-mini"
            />
          </div>
        </div>
      </div>
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
              className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-300 h-24 resize-none focus:outline-none"
            />
          </div>
        ))}
      </div>
    </div>
  );

  const renderHotkeys = () => (
    <div className="bg-neutral-900/60 border border-neutral-800 rounded-xl p-6 shadow-xl">
      <h3 className="text-lg font-medium text-white mb-4">Global Hotkeys</h3>
      <div className="space-y-4">
        <div>
          <label className="text-sm text-neutral-400 block mb-1">Push-to-Talk Key</label>
          <div className="bg-neutral-800 border border-neutral-700 rounded-lg px-4 py-2.5 text-sm text-white flex items-center justify-between">
            <span>F12</span>
            <span className="text-xs text-neutral-500">Current default</span>
          </div>
        </div>
        <div className="text-neutral-500 text-xs">
          Press F12 to start/stop recording (push-to-talk).
        </div>
        <div>
          <label className="text-sm text-neutral-400 block mb-1">Mode</label>
          <div className="flex gap-2">
            <button className="px-4 py-2 bg-orange-600 text-white text-sm rounded-lg">Push-to-Talk</button>
            <button className="px-4 py-2 bg-neutral-800 text-neutral-400 text-sm rounded-lg hover:bg-neutral-700">Toggle</button>
          </div>
        </div>
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
            className="px-4 py-2 bg-neutral-800 hover:bg-orange-600 text-sm text-neutral-300 hover:text-white rounded-lg transition-colors"
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
      <div className="bg-neutral-900/60 border border-neutral-800 rounded-xl p-6 shadow-xl">
        <h3 className="text-lg font-medium text-white mb-4">Usage Analytics</h3>
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-neutral-800/60 rounded-lg p-4 text-center">
            <div className="text-2xl font-bold text-orange-500">{stats[0]}</div>
            <div className="text-xs text-neutral-400 mt-1">Total Dictations</div>
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
        <h3 className="text-lg font-medium text-white mb-4">Recent Transcriptions</h3>
        {history.length === 0 ? (
          <p className="text-neutral-500 text-sm">No history yet. Start dictating with F12!</p>
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
                <p className="text-sm text-neutral-200 line-clamp-2">
                  {entry.formatted_text || entry.raw_text}
                </p>
                {entry.agent_name && (
                  <span className="text-xs text-orange-500/70 mt-1 block">
                    via {entry.agent_name}
                  </span>
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
      case "stt": return renderSTT();
      case "llm": return renderLLM();
      case "hotkeys": return renderHotkeys();
      case "paste": return renderPaste();
      case "history": return renderHistory();
      default: return renderSTT();
    }
  };

  return (
    <div className="min-h-screen bg-black text-neutral-100 flex font-sans">
      <div className="w-64 bg-neutral-950 border-r border-neutral-800 p-5 flex flex-col justify-between">
        <div>
          <div className="flex items-center gap-3 mb-8">
            <div className="w-3 h-3 rounded-full bg-orange-500 shadow-[0_0_12px_rgba(249,115,22,0.8)]" />
            <h1 className="text-xl font-bold tracking-tight text-white">
              v3 <span className="text-xs font-normal text-orange-500 uppercase tracking-widest ml-1">Voice</span>
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
          v3 Dictation • Linux AppImage
        </div>
      </div>

      <div className="flex-1 p-8 bg-neutral-950/50 overflow-y-auto">
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