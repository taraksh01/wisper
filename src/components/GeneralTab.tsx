import { useState, useRef, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";
import { AppSettings, languages } from "../types";
import { Select } from "./Select";
import { PillGroup } from "./PillGroup";
import { ResetButton } from "./ResetButton";
import { Switch } from "./Switch";

interface GeneralTabProps {
  settings: AppSettings;
  onSave: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  onReset: () => void;
}

function SectionCard({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`bg-surface border border-stroke rounded-xl p-4 ${className}`}>
      <h2 className="text-[10px] font-mono text-muted tracking-[0.12em] uppercase mb-3">{title}</h2>
      {children}
    </section>
  );
}

function Keycap({ children, active }: { children: React.ReactNode; active?: boolean }) {
  return (
    <span className={`inline-flex items-center justify-center min-w-[28px] h-[26px] px-1.5 rounded-md text-xs font-mono font-medium transition-all ${
      active
        ? "bg-accent text-white ring-1 ring-accent/50 shadow-sm shadow-accent/20"
        : "bg-elevated text-ink ring-1 ring-stroke"
    }`}>
      {children}
    </span>
  );
}

function HotkeyDisplay({ hotkey }: { hotkey: string }) {
  const parts = hotkey.split("+");
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {parts.map((part) => (
        <Keycap key={part}>{part}</Keycap>
      ))}
    </div>
  );
}

interface PasteEnvironment {
  session_type: string;
  backend: string;
  reliable: boolean;
  preference_unavailable: boolean;
  has_wtype: boolean;
  has_ydotool: boolean;
}

function PasteToolControl({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [env, setEnv] = useState<PasteEnvironment | null>(null);

  const refresh = useCallback(() => {
    invoke<PasteEnvironment>("get_paste_environment", { preference: value })
      .then(setEnv)
      .catch(() => setEnv(null));
  }, [value]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Re-check installed tools when the window regains focus, so a wtype/ydotool
  // installed while the app is open is picked up without a manual refresh.
  useEffect(() => {
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const options = [
    { value: "auto", label: "Auto" },
    {
      value: "wtype",
      label: "wtype",
      disabled: env ? !env.has_wtype : false,
      title: env && !env.has_wtype ? "wtype is not installed — install it to enable this option" : undefined,
    },
    {
      value: "ydotool",
      label: "ydotool",
      disabled: env ? !env.has_ydotool : false,
      title: env && !env.has_ydotool ? "ydotool is not installed — install it to enable this option" : undefined,
    },
    { value: "enigo", label: "Built-in" },
  ];

  return (
    <div>
      <label className="text-[11px] font-mono text-muted block mb-2 tracking-wider">Paste Tool</label>
      <PillGroup value={value} options={options} onChange={onChange} />

      {env && (
        <div className="mt-2 space-y-1.5">
          <div className="flex items-center gap-3 text-[10px] font-mono text-muted">
            <span>
              session: <span className="text-ink">{env.session_type}</span>
            </span>
            <span className="w-1 h-1 rounded-full bg-stroke" />
            <span>
              using: <span className="text-ink">{env.backend === "enigo" ? "built-in" : env.backend}</span>
            </span>
          </div>

          <div className="flex items-center gap-2 text-[10px] font-mono">
            <span className={env.has_wtype ? "text-ready" : "text-muted/50"}>
              {env.has_wtype ? "✓" : "✗"} wtype
            </span>
            <span className={env.has_ydotool ? "text-ready" : "text-muted/50"}>
              {env.has_ydotool ? "✓" : "✗"} ydotool
            </span>
          </div>

          {env.preference_unavailable && (
            <p className="text-[10px] font-mono text-warning leading-relaxed">
              {value} isn't installed — falling back to {env.backend === "enigo" ? "built-in" : env.backend}.
            </p>
          )}

          {!env.reliable && (
            <p className="text-[10px] font-mono text-recording leading-relaxed">
              On Wayland the built-in method can't reliably paste into other apps.
              Install <span className="text-ink">wtype</span> or <span className="text-ink">ydotool</span> for dependable pasting.
            </p>
          )}
        </div>
      )}
     </div>
   );
 }

function StartupControl() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    isEnabled().then(setEnabled).catch(() => setEnabled(null));
  }, []);

  const toggle = useCallback(async (next: boolean) => {
    setBusy(true);
    try {
      if (next) {
        await enable();
      } else {
        await disable();
      }
      setEnabled(await isEnabled());
    } catch {
      // reflect the real state if the change failed
      try {
        setEnabled(await isEnabled());
      } catch {
        setEnabled(null);
      }
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-muted">Start Wisper automatically when you log in</span>
      <Switch
        checked={enabled ?? false}
        disabled={enabled === null || busy}
        onChange={toggle}
      />
    </div>
  );
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
    <div className="max-w-lg space-y-4 card-enter">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
          </svg>
          <h1 className="text-sm font-bold font-mono text-ink tracking-tight">General</h1>
        </div>
        <ResetButton onClick={onReset} />
      </div>

      <SectionCard title="Shortcut Key" className="card-enter">
        <div className="space-y-4">
          <div>
            <label className="text-[11px] font-mono text-muted block mb-2 tracking-wider">Key Combination</label>
            <div className="flex items-center gap-3">
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
                className={`relative px-4 py-2 rounded-lg text-xs font-mono font-medium text-left outline-none ring-1 transition-all cursor-pointer min-w-[140px] ${
                  listening
                    ? "bg-accent/10 text-accent ring-accent/50 animate-pulse"
                    : "bg-elevated text-ink ring-stroke hover:ring-accent/30"
                }`}
              >
                {listening ? (
                  <span className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                    Press a key...
                  </span>
                ) : (
                  <HotkeyDisplay hotkey={settings.hotkey} />
                )}
              </button>
              {message && (
                <span className={`text-[10px] font-mono ${message.ok ? "text-ready" : "text-recording"}`}>
                  {message.ok ? "✓" : "✗"} {message.text}
                </span>
              )}
            </div>
          </div>

          <div>
            <label className="text-[11px] font-mono text-muted block mb-2 tracking-wider">Mode</label>
            <PillGroup
              value={settings.hotkey_mode}
              options={[
                { value: "push-to-talk", label: "Push to Talk" },
                { value: "toggle", label: "Toggle" },
              ]}
              onChange={(v) => onSave("hotkey_mode", v)}
            />
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Language" className="card-enter">
        <Select
          value={settings.language}
          options={languages}
          onChange={(v) => onSave("language", v)}
        />
      </SectionCard>

      <SectionCard title="Output" className="card-enter">
        <div className="space-y-4">
          <div>
            <label className="text-[11px] font-mono text-muted block mb-2 tracking-wider">Paste Method</label>
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
          </div>

          <PasteToolControl
            value={settings.paste_tool}
            onChange={(v) => onSave("paste_tool", v)}
          />
        </div>
      </SectionCard>

      <SectionCard title="Startup" className="card-enter">
        <StartupControl />

        <div className="flex items-center justify-between gap-3 pt-4 mt-4 border-t border-stroke">
          <div>
            <span className="text-xs text-muted">Launch to system tray</span>
            <p className="text-[10px] font-mono text-muted/60 mt-0.5">
              Start hidden with only the tray icon. The window opens on launch by default so you can set up Wisper.
            </p>
          </div>
          <Switch
            checked={settings.launch_to_tray}
            onChange={(v) => onSave("launch_to_tray", v)}
          />
        </div>
      </SectionCard>
    </div>
  );
}
