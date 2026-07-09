import { useState } from "react";
import "./App.css";
import "./styles.css";

function App() {
  const [activeTab, setActiveTab] = useState("stt");

  const tabs = [
    { id: "stt", label: "STT Engine" },
    { id: "llm", label: "LLM Processing" },
    { id: "hotkeys", label: "Hotkeys" },
    { id: "paste", label: "Paste Engine" },
    { id: "history", label: "History" },
  ];

  return (
    <div className="min-h-screen bg-black text-neutral-100 flex font-sans">
      {/* Sidebar */}
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

      {/* Main Content */}
      <div className="flex-1 p-8 bg-neutral-950/50">
        <header className="mb-8 border-b border-neutral-900 pb-4">
          <h2 className="text-2xl font-semibold text-white tracking-tight capitalize">
            {tabs.find((t) => t.id === activeTab)?.label}
          </h2>
          <p className="text-sm text-neutral-400 mt-1">
            Configure preferences for {tabs.find((t) => t.id === activeTab)?.label.toLowerCase()} settings.
          </p>
        </header>

        <div className="bg-neutral-900/60 border border-neutral-800/80 rounded-xl p-6 shadow-xl">
          <div className="flex items-center gap-3 text-orange-500 text-sm font-medium">
            <span className="w-2 h-2 rounded-full bg-orange-500 animate-pulse" />
            Active configuration ready
          </div>
          <p className="text-neutral-400 text-sm mt-3">
            Settings panel interactive controls will appear here.
          </p>
        </div>
      </div>
    </div>
  );
}

export default App;
