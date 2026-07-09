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
          <input
            type="text"
            value={settings.hotkey}
            onChange={(e) => onSave("hotkey", e.target.value.toUpperCase())}
            className="w-full max-w-40 bg-elevated/50 rounded-md px-2.5 py-1.5 text-xs font-mono text-ink outline-none ring-1 ring-stroke focus:ring-accent/40 transition-all"
            placeholder="F12"
          />
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
    </div>
  );
}
