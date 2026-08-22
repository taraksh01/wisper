import { IconGeneral } from "./ui/icons";
import { useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { AppSettings, languages } from "../types";
import { Select } from "./Select";
import { PillGroup } from "./PillGroup";
import { ResetButton } from "./ResetButton";
import { Switch } from "./Switch";
import { SectionCard } from "./SectionCard";
import { ConfirmModal } from "./ConfirmModal";

interface GeneralTabProps {
  settings: AppSettings;
  historyTotal?: number;
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
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    let alive = true;
    invoke<PasteEnvironment>("get_paste_environment", { preference: value })
      .then((e) => alive && setEnv(e))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [value]);

  const options = [
    { value: "auto", label: "Auto" },
    { value: "wtype", label: "wtype", disabled: env ? !env.has_wtype : false, title: env && !env.has_wtype ? "wtype is not installed — install it to enable this option" : undefined },
    { value: "ydotool", label: "ydotool", disabled: env ? !env.has_ydotool : false, title: env && !env.has_ydotool ? "ydotool is not installed — install it to enable this option" : undefined },
    { value: "enigo", label: "Built-in" },
  ];

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <label className="label-soft">Insertion method</label>
        <button
          type="button"
          onClick={() => setShowHelp((v) => !v)}
          aria-label="How to set up ydotool"
          title="How to set up ydotool"
          className="shrink-0 w-4 h-4 rounded-full border border-stroke text-[10px] leading-none text-muted hover:text-accent hover:border-accent/50 flex items-center justify-center transition-colors"
        >
          ?
        </button>
      </div>
      <PillGroup value={value} options={options} onChange={onChange} />

      {showHelp && (
        <div className="mt-3 rounded-lg bg-elevated/40 ring-1 ring-stroke px-3 py-2.5 space-y-2 text-[10px] font-mono text-muted leading-relaxed">
          <p className="text-ink">ydotool types text without ever asking for permission.</p>
          <p>wtype and Built-in may ask for a one-time permission from your desktop the first time they type.</p>
          <a
            href="https://github.com/taraksh01/wisper#setting-up-ydotool-no-prompts"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-accent hover:text-accent-dim transition-colors"
          >
            Full setup guide →
          </a>
        </div>
      )}

      {env && (
        <div className="mt-3 space-y-2 rounded-lg bg-elevated/40 ring-1 ring-stroke px-3 py-2.5">
          <div className="flex items-center gap-3 text-[10px] font-mono text-muted">
            <span>
              Desktop session: <span className="text-ink">{env.session_type}</span>
            </span>
            <span className="w-1 h-1 rounded-full bg-stroke" />
            <span>
              Currently using: <span className="text-ink">{env.backend === "enigo" ? "Built-in" : env.backend}</span>
            </span>
          </div>

          <div className="flex items-center gap-3 text-[10px] font-mono">
            <span className={env.has_wtype ? "text-ready" : "text-muted/50"}>
              {env.has_wtype ? "✓" : "✗"} wtype
            </span>
            <span className={env.has_ydotool ? "text-ready" : "text-muted/50"}>
              {env.has_ydotool ? "✓" : "✗"} ydotool
            </span>
          </div>

          {env.preference_unavailable && (
            <p className="text-[10px] font-mono text-warning leading-relaxed">
              {value} isn't installed, so Wisper will use {env.backend === "enigo" ? "Built-in" : env.backend} instead.
            </p>
          )}

          {!env.reliable && (
            <p className="text-[10px] font-mono text-recording leading-relaxed">
              Your desktop (Wayland) blocks the built-in method from typing into other apps.
              Install <span className="text-ink">wtype</span> or <span className="text-ink">ydotool</span> so dictation always lands correctly.
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
      <span className="text-xs text-muted">Start Wisper when you log in</span>
      <Switch label="Start Wisper automatically when you log in" checked={value} onChange={onChange} />
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

function VadThresholdControl({ threshold, onChange }: { threshold: number; onChange: (v: number) => void }) {
  const [level, setLevel] = useState(0);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (!testing) return;
    let alive = true;
    let raf = 0;
    invoke("start_mic_preview").catch(() => {});
    async function loop() {
      try {
        const l = await invoke<number>("get_input_level");
        if (alive) setLevel(l);
      } catch {}
      if (alive) raf = requestAnimationFrame(loop);
    }
    loop();
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      invoke("stop_mic_preview").catch(() => {});
    };
  }, [testing]);

  const startToggle = () => {
    if (testing) {
      setTesting(false);
    } else {
      setLevel(0);
      setTesting(true);
    }
  };

  const barCount = 10;
  const filled = Math.max(0, Math.round((level / 0.3) * barCount));
  const threshIdx = Math.max(0, Math.min(barCount - 1, Math.round(threshold * barCount)));

  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center gap-2">
        <label className="label-soft">Noise cutoff</label>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={threshold}
          onChange={(e) => onChange(Number(e.target.value))}
          className="flex-1 accent-accent"
          aria-label="VAD threshold"
        />
        <span className="text-xs font-mono text-muted w-10 text-right">{Math.round(threshold * 100)}%</span>
      </div>
      <div className="flex items-end gap-1 h-6">
        {[...Array(barCount)].map((_, i) => {
          const aboveThresh = i >= threshIdx;
          const active = i < filled && aboveThresh;
          const cls = active
            ? "bg-accent"
            : i === threshIdx
            ? "bg-accent/50"
            : aboveThresh
            ? "bg-elevated"
            : "bg-elevated/40";
          return (
            <div
              key={i}
              className={`flex-1 rounded transition-colors ${cls}`}
              style={{ height: `${Math.max(4, (i + 1) * 3)}px` }}
            />
          );
        })}
      </div>
      <button
        onClick={startToggle}
        className="text-xs font-mono text-muted hover:text-ink transition-colors"
      >
        {testing ? "Stop testing" : "Test microphone level"}
      </button>
    </div>
  );
}

export function GeneralTab({ settings, historyTotal = 0, onSave, onReset }: GeneralTabProps) {
  const [listening, setListening] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [inputDevices, setInputDevices] = useState<[string, string][]>([]);
  const [pendingMax, setPendingMax] = useState(settings.max_history_entries);
  const [trimConfirm, setTrimConfirm] = useState<{ newLimit: number; excess: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const pendingModsRef = useRef<Set<string>>(new Set());
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    invoke<[string, string][]>("list_audio_devices").then(setInputDevices).catch(() => {});
  }, []);

  useEffect(() => {
    setPendingMax(settings.max_history_entries);
  }, [settings.max_history_entries]);

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
    try {
      await invoke("set_hotkey", { key: hotkey });
      onSave("hotkey", hotkey);
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
    <div className="w-full space-y-4 py-1 card-enter">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <IconGeneral className="w-5 h-5 text-accent" />
          <h1 className="text-sm font-semibold text-ink tracking-tight">General</h1>
        </div>
        <ResetButton onClick={onReset} />
      </div>

      <SectionCard title="Keyboard Shortcut">
        <div className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <button
              ref={btnRef}
              onClick={startListening}
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
                  Press a key…
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
              Press one key like <span className="text-ink">F9</span>, or combine like <span className="text-ink">Ctrl+K</span>. A modifier alone (just Ctrl) won't work.
            </p>
            <button
              onClick={() => setShowKeys(true)}
              className="text-[10px] font-mono text-accent hover:text-accent-dim underline underline-offset-2 shrink-0"
            >
              Example keys
            </button>
          </div>

          <div>
            <label className="label-soft block mb-2">Mode</label>
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

          <div className="rounded-lg bg-elevated/40 ring-1 ring-stroke divide-y divide-stroke">
            <div className="flex items-center justify-between gap-4 px-3 py-2.5">
              <div>
                <label className="label-soft block mb-0.5">Show Overlay</label>
                <p className="text-[10px] font-mono text-muted/70 leading-relaxed">
                  Show a small banner on screen while you're speaking.
                </p>
              </div>
              <Switch label="Show Overlay" checked={settings.overlay_enabled} onChange={(v) => onSave("overlay_enabled", v)} />
            </div>

            <div className="px-3 py-2.5">
              <label className="label-soft block mb-2">Overlay Position</label>
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
        </div>
      </SectionCard>

      <SectionCard title="Microphone">
        <div className="space-y-2">
          <label className="label-soft block">Microphone</label>
          <Select
            value={settings.input_device}
            options={[
              { value: "", label: "System default" },
              ...inputDevices.map(([id, name]) => ({ value: id, label: name })),
            ]}
            onChange={(v) => onSave("input_device", v)}
          />
          <p className="text-[10px] font-mono text-muted/70 leading-relaxed">
            Pick which microphone Wisper listens to. "System default" uses whatever your OS has selected.
          </p>
        </div>
      </SectionCard>

      <SectionCard title="Silence Trimming">
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <label className="label-soft block mb-1">Cut quiet parts automatically</label>
              <p className="text-[10px] font-mono text-muted/70 leading-relaxed">
                Ignores silence and background noise so only your speech is transcribed.
              </p>
            </div>
            <Switch label="Trim silence from recordings" checked={settings.vad_enabled} onChange={(v) => onSave("vad_enabled", v)} />
          </div>
          {settings.vad_enabled && (
            <VadThresholdControl threshold={settings.vad_threshold} onChange={(v) => onSave("vad_threshold", v)} />
          )}
        </div>
      </SectionCard>

      <SectionCard title="Output">
        <div className="space-y-4">
          <div>
            <label className="label-soft block mb-2">How text is inserted</label>
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
          <Switch label="Launch to system tray" checked={settings.launch_to_tray} onChange={(v) => onSave("launch_to_tray", v)} />
        </div>
      </SectionCard>

      <SectionCard title="History">
        <div className="space-y-4">
          <div>
            <label className="label-soft block mb-2">Maximum history entries</label>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min={0}
                step={1}
                value={pendingMax}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  setPendingMax(Number.isFinite(v) ? Math.max(0, v) : 0);
                }}
                onBlur={() => {
                  const v = pendingMax;
                  if (v === settings.max_history_entries) return;
                  if (v > 0 && v < historyTotal && v < settings.max_history_entries) {
                    const excess = historyTotal - v;
                    setTrimConfirm({ newLimit: v, excess });
                  } else {
                    onSave("max_history_entries", v);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  if (e.key === "Escape") setPendingMax(settings.max_history_entries);
                }}
                className="w-28 bg-surface border border-stroke rounded-xl px-3 py-2 text-xs font-mono text-ink placeholder:text-muted/50 outline-none focus:border-accent/40 focus:ring-2 focus:ring-accent/15 transition-[border-color,box-shadow] duration-150"
                placeholder="500"
              />
              <span className="text-[10px] font-mono text-muted">entries · 0 means unlimited</span>
            </div>
            <p className="text-[10px] font-mono text-muted/60 leading-relaxed mt-2">
              Older entries beyond this limit are removed automatically.
            </p>
          </div>

          {settings.keep_recordings && (
            <div>
              <label className="label-soft block mb-2">When limit is reached</label>
              <PillGroup
                value={settings.history_retention_mode}
                options={[
                  { value: "both", label: "Delete transcription and recording" },
                  { value: "recordings_only", label: "Delete recording only (keep text)" },
                ]}
                onChange={(v) => onSave("history_retention_mode", v)}
              />
              <p className="text-[10px] font-mono text-muted/60 leading-relaxed mt-2">
                Keep the transcript text but free up disk space by removing old audio.
              </p>
            </div>
          )}
        </div>
      </SectionCard>

      {trimConfirm && (
        <ConfirmModal
          title="Trim history?"
          message={
            settings.keep_recordings && settings.history_retention_mode === "recordings_only"
              ? `This will remove recordings from the ${trimConfirm.excess} oldest entries beyond ${trimConfirm.newLimit}. Transcripts will be kept.`
              : `This will permanently delete the ${trimConfirm.excess} oldest entries beyond ${trimConfirm.newLimit}.`
          }
          confirmLabel="Trim"
          onConfirm={() => {
            onSave("max_history_entries", trimConfirm.newLimit);
            setTrimConfirm(null);
          }}
          onCancel={() => {
            setPendingMax(settings.max_history_entries);
            setTrimConfirm(null);
          }}
        />
      )}

      <SectionCard title="Language">
        <label className="label-soft block mb-2">Transcription Language</label>
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