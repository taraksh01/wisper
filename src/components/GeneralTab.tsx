import { useState, useRef, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AppSettings, languages } from "../types";
import { Select } from "./Select";

function ResetButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="text-[10px] font-mono text-accent/60 hover:text-accent transition-colors flex items-center gap-1"
    >
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
      Reset tab
    </button>
  );
}

interface GeneralTabProps {
  settings: AppSettings;
  onSave: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  onReset: () => void;
}

export function GeneralTab({ settings, onSave, onReset }: GeneralTabProps) {
  const [listening, setListening] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    return () => clearTimeout(timerRef.current);
  }, []);

  const showMessage = useCallback((text: string, ok: boolean) => {
    setMessage({ text, ok });
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setMessage(null), 2500);
  }, []);

  const startListening = useCallback(() => {
    setListening(true);
    setMessage(null);
    setTimeout(() => btnRef.current?.focus(), 0);
  }, []);

  const setHotkey = useCallback(async (key: string) => {
    const hotkey = key.length === 1 ? key.toUpperCase() : key;
    onSave("hotkey", hotkey);
    try {
      await invoke("set_hotkey", { key: hotkey });
      showMessage(`Hotkey set to ${hotkey}`, true);
    } catch (e) {
      showMessage(String(e), false);
    }
  }, [onSave, showMessage]);

  return (
    <div className="space-y-4 panel-enter">
      <div className="flex items-center justify-between panel-enter">
        <div />
        <ResetButton onClick={onReset} />
      </div>

      <section className="panel-enter">
        <div className="text-xs font-mono text-muted mb-3 tracking-wider uppercase">Shortcut Key</div>
        <div className="mb-3">
          <label className="text-[11px] font-mono text-muted block mb-1 tracking-wider">Key</label>
          <button
            ref={btnRef}
            onClick={startListening}
            onBlur={() => setListening(false)}
            onKeyDown={(e) => {
              if (!listening) return;
              e.preventDefault();
              e.stopPropagation();
              const key = e.key;
              const ignored = ["Shift", "Control", "Alt", "Meta", "CapsLock", "Tab", "Enter"];
              if (ignored.includes(key)) return;
              setListening(false);

              // Build modifier prefix
              const mods: string[] = [];
              if (e.ctrlKey) mods.push("Ctrl");
              if (e.altKey) mods.push("Alt");
              if (e.shiftKey) mods.push("Shift");
              if (e.metaKey) mods.push("Meta");

              const mainKey = key === " " ? "Space" : key.length === 1 ? key.toUpperCase() : key;
              const hotkey = mods.length > 0 ? [...mods, mainKey].join("+") : mainKey;
              setHotkey(hotkey);
            }}
            tabIndex={0}
            className={`w-full max-w-40 bg-elevated/50 rounded-md px-2.5 py-1.5 text-xs font-mono text-left outline-none ring-1 transition-all cursor-pointer ${
              listening
                ? "text-accent ring-accent/60 animate-pulse"
                : "text-ink ring-stroke hover:ring-accent/40"
            }`}
          >
            {listening ? "Press a key..." : settings.hotkey}
          </button>
          {message && (
            <p className={`text-[10px] font-mono mt-1.5 ${message.ok ? "text-ready" : "text-recording"}`}>
              {message.ok ? "✓" : "✗"} {message.text}
            </p>
          )}
        </div>
        <div>
          <label className="text-[11px] font-mono text-muted block mb-1.5 tracking-wider">Mode</label>
          <div className="flex gap-1.5">
            {[
              { id: "push-to-talk", label: "Push to Talk" },
              { id: "toggle", label: "Toggle" },
            ].map((mode) => (
              <button
                key={mode.id}
                onClick={() => onSave("hotkey_mode", mode.id)}
                className={`px-3 py-1.5 text-xs font-mono font-medium rounded-md transition-all duration-150 ${
                  settings.hotkey_mode === mode.id
                    ? "bg-accent/15 text-accent ring-1 ring-accent/30"
                    : "text-muted hover:text-ink hover:bg-elevated"
                }`}
              >
                {mode.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="panel-enter">
        <div className="text-xs font-mono text-muted mb-2 tracking-wider uppercase">Language</div>
        <Select
          value={settings.language}
          options={languages}
          onChange={(v) => onSave("language", v)}
        />
      </section>

      <section className="panel-enter">
        <div className="text-xs font-mono text-muted mb-2 tracking-wider uppercase">Output</div>
        <div className="flex flex-wrap gap-1.5">
          {["Ctrl+V", "Ctrl+Shift+V", "Shift+Insert", "Direct Typing"].map((method) => (
            <button
              key={method}
              onClick={() => onSave("paste_method", method)}
              className={`px-3 py-1.5 text-xs font-mono font-medium rounded-md transition-all duration-150 ${
                settings.paste_method === method
                  ? "bg-accent/15 text-accent ring-1 ring-accent/30"
                  : "text-muted hover:text-ink hover:bg-elevated"
              }`}
            >
              {method}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
