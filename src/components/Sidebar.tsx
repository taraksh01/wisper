import { type JSX, useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { AppSettings, tabs } from "../types";

interface SidebarProps {
  activeTab: string;
  appState: string;
  settings: AppSettings | null;
  currentModelName: string;
  onTabChange: (id: string) => void;
  onUnloadModel: () => void;
  onOpenEngineTab: () => void;
}

const tabIcons: Record<string, JSX.Element> = {
  general: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
    </svg>
  ),
  stt: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  ),
  llm: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 3 21 3 21 8" />
      <line x1="4" y1="20" x2="21" y2="3" />
      <polyline points="21 16 21 21 16 21" />
      <line x1="15" y1="15" x2="21" y2="21" />
      <line x1="4" y1="4" x2="9" y2="9" />
    </svg>
  ),
  history: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  about: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  ),
  donate: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  ),
};

const stateDot = (state: string) => {
  switch (state) {
    case "recording": return "bg-recording animate-pulse shadow-[0_0_6px_rgba(239,68,68,0.6)]";
    case "processing": return "bg-warning animate-pulse shadow-[0_0_6px_rgba(234,179,8,0.6)]";
    default: return "bg-ready";
  }
};

const stateLabel = (state: string) => {
  switch (state) {
    case "recording": return "Recording";
    case "processing": return "Processing";
    default: return "Ready";
  }
};

export function Sidebar({ activeTab, appState, settings, currentModelName, onTabChange, onUnloadModel, onOpenEngineTab }: SidebarProps) {
  const [version, setVersion] = useState("");

  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
  }, []);

  return (
    <aside className="w-44 shrink-0 bg-surface border-r border-stroke flex flex-col">
      <div className="flex-1 px-4 py-5 flex flex-col gap-6">
        <div className="flex items-center gap-2.5 px-1">
          <div className={`w-2.5 h-2.5 rounded-full ${stateDot(appState)} transition-all duration-300`} />
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-bold tracking-tight text-ink font-mono leading-tight">Wisper</h1>
            <p className="text-[9px] font-mono text-muted tracking-[0.15em] uppercase leading-tight">{stateLabel(appState)}</p>
          </div>
        </div>

        {currentModelName && settings && (
          <div className="px-1">
            {settings.stt_mode === "local" ? (
              <div className="flex items-center gap-1 px-2 py-1.5 rounded-md bg-accent/8 border border-accent/15 group">
                <span className="text-[9px] font-mono text-accent truncate flex-1" title={currentModelName}>
                  {currentModelName}
                </span>
                <button
                  onClick={onUnloadModel}
                  className="shrink-0 p-0.5 rounded text-accent-dim/50 opacity-0 group-hover:opacity-100 hover:text-recording transition-all"
                  title="Unload model"
                >
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            ) : (
              <button
                onClick={onOpenEngineTab}
                className="flex items-center gap-1.5 px-2 py-1.5 rounded-md border border-stroke hover:bg-elevated/50 w-full text-left transition-colors group"
              >
                <span className="text-[9px] font-mono text-accent truncate flex-1" title={currentModelName}>
                  {currentModelName}
                </span>
                <svg className="w-3 h-3 shrink-0 text-muted/40 group-hover:text-muted transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            )}
          </div>
        )}

        <nav className="flex flex-col gap-0.5">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium font-mono transition-all duration-150 ${
                  isActive
                    ? "bg-accent text-white shadow-sm shadow-accent/30"
                    : "text-muted hover:text-ink hover:bg-elevated/60"
                }`}
              >
                <span className={`shrink-0 ${isActive ? "text-white/80" : "text-muted/50"}`}>
                  {tabIcons[tab.id]}
                </span>
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="px-4 py-3 border-t border-stroke text-[9px] font-mono text-muted/50 tracking-wider">
        Wisper &bull; {version}
      </div>
    </aside>
  );
}
