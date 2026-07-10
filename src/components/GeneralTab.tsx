import { useState, useRef, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AppSettings, languages } from "../types";
import { Select } from "./Select";
import { PillGroup } from "./PillGroup";
import { ResetButton } from "./ResetButton";

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
          <PillGroup
            value={settings.hotkey_mode}
            options={[
              { value: "push-to-talk", label: "Push to Talk" },
              { value: "toggle", label: "Toggle" },
            ]}
            onChange={(v) => onSave("hotkey_mode", v)}
          />
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
          <PillGroup
            value={settings.paste_method}
            options={[
              { value: "Ctrl+V", label: "Ctrl+V" },
              { value: "Ctrl+Shift+V", label: "Ctrl+Shift+V" },
              { value: "Shift+Insert", label: "Shift+Insert" },
              { value: "Direct Typing", label: "Direct Typing" },
            ]}
            onChange={(v) => onSave("paste_method", v)}
          />
      </section>
    </div>
  );
}
