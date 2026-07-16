import { useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { AppSettings, languages } from "../types";
import { Select } from "./Select";
import { PillGroup } from "./PillGroup";
import { ResetButton } from "./ResetButton";
import { Switch } from "./Switch";
import { SectionCard } from "./SectionCard";

interface GeneralTabProps {
  settings: AppSettings;
  onSave: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  onReset: () => void;
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
  const pretty: Record<string, string> = {
    Super: "Meta",
    SuperLeft: "Meta L",
    SuperRight: "Meta R",
    CtrlLeft: "Ctrl L",
    CtrlRight: "Ctrl R",
    AltLeft: "Alt L",
    AltRight: "Alt R",
    ShiftLeft: "Shift L",
    ShiftRight: "Shift R",
    ArrowUp: "↑",
    ArrowDown: "↓",
    ArrowLeft: "←",
    ArrowRight: "→",
  };
  const parts = hotkey.split("+");
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {parts.map((part) => (
        <Keycap key={part}>{pretty[part] ?? part}</Keycap>
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

  useEffect(() => {
    let alive = true;
    invoke<PasteEnvironment>("get_paste_environment")
      .then((e) => alive && setEnv(e))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const options = [
    { value: "auto", label: "Auto" },
    { value: "wtype", label: "wtype", disabled: env ? !env.has_wtype : false, title: env && !env.has_wtype ? "wtype is not installed — install it to enable this option" : undefined },
    { value: "ydotool", label: "ydotool", disabled: env ? !env.has_ydotool : false, title: env && !env.has_ydotool ? "ydotool is not installed — install it to enable this option" : undefined },
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

function StartupControl({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-muted">Start Wisper automatically when you log in</span>
      <Switch
        checked={value}
        onChange={onChange}
      />
    </div>
  );
}

const MODIFIER_CODES = new Set([
  "ControlLeft", "ControlRight", "ShiftLeft", "ShiftRight",
  "AltLeft", "AltRight", "MetaLeft", "MetaRight",
]);

function isModifierCode(code: string): boolean {
  return MODIFIER_CODES.has(code);
}

function codeToToken(code: string): string | null {
  switch (code) {
    case "ControlLeft":
      return "CtrlLeft";
    case "ControlRight":
      return "CtrlRight";
    case "ShiftLeft":
      return "ShiftLeft";
    case "ShiftRight":
      return "ShiftRight";
    case "AltLeft":
      return "AltLeft";
    case "AltRight":
      return "AltRight";
    case "MetaLeft":
      return "SuperLeft";
    case "MetaRight":
      return "SuperRight";
  }
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("F") && /^[0-9]+$/.test(code.slice(1))) return code;
  const map: Record<string, string> = {
    Space: "Space",
    Enter: "Enter",
    Tab: "Tab",
    Backspace: "Backspace",
    Escape: "Escape",
    Delete: "Delete",
    Insert: "Insert",
    Home: "Home",
    End: "End",
    PageUp: "PageUp",
    PageDown: "PageDown",
    ArrowUp: "ArrowUp",
    ArrowDown: "ArrowDown",
    ArrowLeft: "ArrowLeft",
    ArrowRight: "ArrowRight",
    CapsLock: "CapsLock",
    ScrollLock: "ScrollLock",
    Pause: "Pause",
    PrintScreen: "PrintScreen",
    NumLock: "NumLock",
  };
  return map[code] ?? null;
}

function SupportedKeysModal({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [
    ["F9, F13, F1–F12", "Single key — works in every app, best for push-to-talk"],
    ["ScrollLock, Pause", "Single key — almost never used by apps"],
    ["CtrlRight+Space", "Modifier + key (side-specific modifiers work)"],
    ["AltLeft+K", "Any Mod+Key combo"],
  ];
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-surface border border-stroke rounded-xl p-5 max-w-sm w-full mx-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-bold font-mono text-ink">Example hotkeys</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex items-center justify-center w-6 h-6 rounded-md text-muted hover:text-ink hover:bg-elevated ring-1 ring-stroke hover:ring-accent/30 transition-all"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <p className="text-[10px] font-mono text-muted/70 mb-3 leading-relaxed">
          Anything your keyboard can send works — these are just a few ideas.
        </p>
        <ul className="space-y-2">
          {rows.map(([k, desc]) => (
            <li key={k} className="flex items-start gap-3">
              <code className="shrink-0 px-2 py-1 text-[10px] font-mono text-ink bg-elevated rounded-md ring-1 ring-stroke">{k}</code>
              <span className="text-[10px] font-mono text-muted leading-relaxed">{desc}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[10px] font-mono text-muted/70 leading-relaxed">
          A bare modifier alone (e.g. RightAlt with no other key) isn't supported.
        </p>
        <div className="flex justify-end mt-4">
          <button onClick={onClose} className="px-3 py-1.5 text-xs font-mono text-white bg-accent rounded-md hover:bg-accent-dim transition-all">
            Got it
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export function GeneralTab({ settings, onSave, onReset }: GeneralTabProps) {
  const [listening, setListening] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const pendingModsRef = useRef<Set<string>>(new Set());
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
    pendingModsRef.current.clear();
    setListening(true);
    setMessage(null);
    setTimeout(() => btnRef.current?.focus(), 0);
  }, []);

  const setHotkey = useCallback(async (key: string) => {
    const hotkey = key.length === 1 ? key.toUpperCase() : key;
    const isBareModifier = /^(CtrlLeft|CtrlRight|ShiftLeft|ShiftRight|AltLeft|AltRight|SuperLeft|SuperRight)$/.test(hotkey);
    if (isBareModifier) {
      showMessage("Combine a modifier with a key (e.g. CtrlRight+Space)", false);
      return;
    }
    onSave("hotkey", hotkey);
    try {
      await invoke("set_hotkey", { key: hotkey });
      showMessage(`Hotkey set to ${hotkey}`, true);
    } catch (e) {
      showMessage(String(e), false);
    }
  }, [onSave, showMessage]);

  useEffect(() => {
    if (!listening) return;
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const code = e.code;
      if (code === "Escape") {
        setListening(false);
        return;
      }
      const token = codeToToken(code);
      if (!token) return;
      if (isModifierCode(code)) {
        pendingModsRef.current.add(token);
        return;
      }
      setListening(false);
      const mods = Array.from(pendingModsRef.current);
      pendingModsRef.current.clear();
      setHotkey(mods.length > 0 ? [...mods, token].join("+") : token);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [listening, setHotkey]);

  return (
    <div className="max-w-lg mx-auto space-y-5 py-1 card-enter">
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

      <SectionCard title="Shortcut Key">
        <div className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <button
              ref={btnRef}
              onClick={startListening}
              tabIndex={0}
              className={`relative px-4 py-2 rounded-lg text-xs font-mono font-medium text-left outline-none ring-1 transition-all cursor-pointer min-w-[150px] ${
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
            <span className="text-[10px] font-mono text-muted">
              {listening ? "Listening…" : "Click, then press a key"}
            </span>
          </div>

          {message && (
            <p className={`text-[10px] font-mono ${message.ok ? "text-ready" : "text-recording"}`}>
              {message.ok ? "✓" : "✗"} {message.text}
            </p>
          )}

          <div className="flex items-center gap-3 flex-wrap">
            <p className="text-[10px] font-mono text-muted leading-relaxed">
              Single keys like <span className="text-ink">F9</span> work everywhere. Or <span className="text-ink">Mod+Key</span>. Bare modifiers aren't supported.
            </p>
            <button
              onClick={() => setShowKeys(true)}
              className="text-[10px] font-mono text-accent hover:text-accent-dim underline underline-offset-2 shrink-0"
            >
              Example keys
            </button>
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
            <p className="text-[10px] font-mono text-muted/70 leading-relaxed mt-2">
              {settings.hotkey_mode === "push-to-talk"
                ? `Hold ${settings.hotkey} to talk — release to stop.`
                : `Press ${settings.hotkey} to start, press again to stop.`}
            </p>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div>
              <label className="text-[11px] font-mono text-muted block mb-1 tracking-wider">Show Overlay</label>
              <p className="text-[10px] font-mono text-muted/70 leading-relaxed">
                Floating recording indicator while you dictate.
              </p>
            </div>
            <button
              role="switch"
              aria-checked={settings.overlay_enabled}
              onClick={() => onSave("overlay_enabled", !settings.overlay_enabled)}
              className={`relative w-10 h-6 rounded-full transition-colors shrink-0 ${settings.overlay_enabled ? "bg-accent" : "bg-stroke"}`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${settings.overlay_enabled ? "translate-x-4" : ""}`}
              />
            </button>
          </div>

          <div>
            <label className="text-[11px] font-mono text-muted block mb-2 tracking-wider">Overlay Position</label>
            <PillGroup
              value={settings.overlay_position}
              options={[
                { value: "top", label: "Top Center" },
                { value: "bottom", label: "Bottom Center" },
              ]}
              onChange={(v) => onSave("overlay_position", v)}
            />
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Output">
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

      <SectionCard title="Startup">
        <StartupControl value={settings.autostart} onChange={(v) => onSave("autostart", v)} />

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

      <SectionCard title="Language">
        <label className="text-[11px] font-mono text-muted block mb-2 tracking-wider">Transcription Language</label>
        <Select
          value={settings.language}
          onChange={(v) => onSave("language", v)}
          options={[{ value: "auto", label: "Auto-detect" }, ...languages.filter((l) => l.value !== "auto")]}
        />
      </SectionCard>

      {showKeys && <SupportedKeysModal onClose={() => setShowKeys(false)} />}
    </div>
  );
}
