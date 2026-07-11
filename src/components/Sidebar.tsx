import { type JSX, useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { AppSettings, tabs } from "../types";
import { WisperLogo } from "./WisperLogo";

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
      <path d="M12 5a3 3 0 1 0-5.997.142 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
      <path d="M12 5a3 3 0 1 1 5.997.142 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
      <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
      <path d="M17.599 6.5a3 3 0 0 0 .399-1.375" />
      <path d="M6.003 5.125A3 3 0 0 0 6.401 6.5" />
      <path d="M3.477 10.896a4 4 0 0 1 .585-.396" />
      <path d="M19.938 10.5a4 4 0 0 1 .585.396" />
      <path d="M6 18a4 4 0 0 1-1.967-.516" />
      <path d="M19.967 17.484A4 4 0 0 1 18 18" />
    </svg>
  ),
  llm: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2 13.7 8.3 20 10 13.7 11.7 12 18 10.3 11.7 4 10 10.3 8.3Z" />
      <path d="M18 14l.9 2.1L21 17l-2.1.9L18 20l-.9-2.1L15 17l2.1-.9Z" />
    </svg>
  ),
  vocab: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
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

const stateLabel = (state: string) => {
  switch (state) {
    case "recording": return "Recording";
    case "processing": return "Processing";
    default: return "Ready";
  }
};

export function Sidebar({ activeTab, appState, settings, currentModelName, onTabChange, onUnloadModel, onOpenEngineTab }: SidebarProps) {
  const [version, setVersion] = useState("");
  const [level, setLevel] = useState(0);

  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
  }, []);

  // Poll the live microphone amplitude only while recording, so the waveform
  // reacts to the user's actual voice instead of a canned animation.
  useEffect(() => {
    if (appState !== "recording") {
      setLevel(0);
      return;
    }
    let active = true;
    const tick = async () => {
      try {
        const l = await invoke<number>("get_input_level");
        if (active) setLevel(l);
      } catch {
        // ignore
      }
    };
    const id = setInterval(tick, 60);
    tick();
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [appState]);

  return (
    <aside className="w-44 shrink-0 bg-surface border-r border-stroke flex flex-col">
      <div className="flex-1 px-4 py-5 flex flex-col gap-6">
        <div className="flex items-center gap-2.5 px-1">
          <WisperLogo className="w-8 h-8 shrink-0" state={appState as "idle" | "recording" | "processing"} level={level} />
          <div className="flex-1 min-w-0 flex flex-col gap-1.5">
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
