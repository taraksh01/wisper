import { AppSettings } from "../types";

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

interface PasteTabProps {
  settings: AppSettings;
  onSave: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  onReset: () => void;
}

const pasteMethods = ["Ctrl+V", "Ctrl+Shift+V", "Shift+Insert", "Direct Typing"];

export function PasteTab({ settings, onSave, onReset }: PasteTabProps) {
  return (
    <div className="space-y-3 panel-enter">
      <div className="flex items-center justify-between panel-enter">
        <div />
        <ResetButton onClick={onReset} />
      </div>

      <section className="panel-enter">
        <div className="text-xs font-mono text-muted mb-2 tracking-wider uppercase">Paste Method</div>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {pasteMethods.map((method) => (
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
        <div className="text-[11px] text-muted">
          Display server: <span className="text-accent">Auto-detected</span>
        </div>
      </section>
    </div>
  );
}
