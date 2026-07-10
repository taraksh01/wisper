import { AppSettings } from "../types";
import { PillGroup } from "./PillGroup";
import { ResetButton } from "./ResetButton";

interface PasteTabProps {
  settings: AppSettings;
  onSave: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  onReset: () => void;
}

export function PasteTab({ settings, onSave, onReset }: PasteTabProps) {
  return (
    <div className="space-y-3 panel-enter">
      <div className="flex items-center justify-between panel-enter">
        <div />
        <ResetButton onClick={onReset} />
      </div>

      <section className="panel-enter">
        <div className="text-xs font-mono text-muted mb-2 tracking-wider uppercase">Paste Method</div>
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
        <div className="text-[11px] text-muted">
          Display server: <span className="text-accent">Auto-detected</span>
        </div>
      </section>
    </div>
  );
}
