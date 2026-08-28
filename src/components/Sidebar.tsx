import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { AppSettings, tabs } from "../types";
import { APP_NAME } from "../appConfig";
import { WisperLogo } from "./WisperLogo";
import { tabIconMap, IconCloseSmall, IconChevronRight } from "./ui/icons";

interface SidebarProps {
  activeTab: string;
  appState: string;
  settings: AppSettings | null;
  currentModelName: string;
  onTabChange: (id: string) => void;
  onUnloadModel: () => void;
  onOpenEngineTab: () => void;
}

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
      } catch {}
    };
    const id = setInterval(tick, 60);
    tick();
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [appState]);

  return (
    <aside className="w-[200px] shrink-0 bg-surface border-r border-stroke flex flex-col relative">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/[0.06] to-transparent pointer-events-none" />

      <div className="flex-1 flex flex-col min-h-0">
        <div className="px-4 pt-5 pb-4">
          <div className="flex items-center gap-2.5 px-1">
            <WisperLogo className="w-8 h-8 shrink-0" state={appState as "idle" | "recording" | "processing"} level={level} />
            <div className="flex-1 min-w-0 flex flex-col gap-1">
              <h1 className="text-sm font-bold tracking-tight text-ink font-mono leading-none">{APP_NAME}</h1>
              <p className="text-[9px] font-mono text-muted tracking-[0.14em] uppercase leading-none">{stateLabel(appState)}</p>
            </div>
          </div>

          {currentModelName && settings && (
            <div className="mt-4 px-1">
              {settings.engine_mode === "local" ? (
                <div
                  role="button"
                  tabIndex={0}
                  onClick={onOpenEngineTab}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onOpenEngineTab();
                    }
                  }}
                  className="group cursor-pointer flex items-center gap-2 px-2.5 py-2 h-9 rounded-xl bg-elevated border border-stroke hover:border-accent/20 transition-colors"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0 animate-pulse" />
                  <span className="text-[11px] font-medium text-ink truncate flex-1" title={currentModelName}>
                    {currentModelName}
                  </span>
                  <IconChevronRight className="w-3 h-3 shrink-0 text-muted/40 group-hover:text-muted" />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onUnloadModel();
                    }}
                    className="shrink-0 w-5 h-5 grid place-items-center rounded-full bg-surface border border-stroke text-muted hover:text-recording hover:border-recording/30 opacity-0 group-hover:opacity-100 transition-all transition-transform duration-150 active:scale-[0.98]"
                    title="Unload model"
                  >
                    <IconCloseSmall className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={onOpenEngineTab}
                  className="transition-transform duration-150 active:scale-[0.98] flex items-center gap-2 px-2.5 py-2 h-9 rounded-xl bg-elevated border border-stroke hover:border-accent/20 w-full text-left transition-colors group"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-ready shrink-0" />
                  <span className="text-[11px] font-medium text-ink truncate flex-1" title={currentModelName}>
                    {currentModelName}
                  </span>
                  <IconChevronRight className="w-3 h-3 shrink-0 text-muted/40 group-hover:text-muted" />
                </button>
              )}
            </div>
          )}
        </div>

        <nav className="px-2.5 flex flex-col gap-1 flex-1 overflow-y-auto custom-scrollbar pb-4">
          <div className="px-2 py-2">
            <span className="text-[10px] font-semibold tracking-[0.14em] uppercase text-muted/50">Menu</span>
          </div>
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            const Icon = tabIconMap[tab.id as keyof typeof tabIconMap];
            return (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                aria-current={isActive ? "page" : undefined}
                className={`transition-transform duration-150 active:scale-[0.98] group flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium text-left transition-colors duration-150 border ${
                  isActive
                    ? "bg-accent/10 text-accent border-accent/15 shadow-sm"
                    : "text-muted border-transparent hover:text-ink hover:bg-elevated hover:border-stroke"
                }`}
              >
                <span className={`shrink-0 w-6 h-6 grid place-items-center rounded-lg border transition-colors ${isActive ? "bg-accent border-accent text-white" : "bg-surface border-stroke group-hover:bg-elevated text-muted group-hover:text-ink"}`}>
                  <Icon className="w-4 h-4" />
                </span>
                <span className="flex-1 truncate tracking-[-0.01em]">{tab.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      <div className="shrink-0 px-3.5 py-3.5 border-t border-stroke/80 bg-elevated/20 space-y-3">
        {settings && (
          <div className="flex items-center justify-between gap-2 rounded-xl bg-surface border border-stroke px-3 py-2">
            <span className="text-[10px] font-medium tracking-widest uppercase text-muted">Hold</span>
            <kbd className="inline-flex items-center justify-center min-h-[20px] px-1.5 py-0.5 bg-elevated border border-stroke border-b-[2px] rounded-md text-[10px] font-mono font-medium text-ink shadow-[0_1px_0_rgba(0,0,0,0.06)]">{settings.hotkey}</kbd>
            <span className="text-[10px] font-medium tracking-widest uppercase text-muted">to talk</span>
          </div>
        )}
        <div className="flex items-center justify-between text-[10px] font-mono text-muted/50 tracking-wider">
          <span>{APP_NAME} · {version || "—"}</span>
          <span className={`w-1.5 h-1.5 rounded-full ${appState === "recording" ? "bg-recording" : appState === "processing" ? "bg-accent" : "bg-ready/60"}`} />
        </div>
      </div>
    </aside>
  );
}
