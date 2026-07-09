import { AppSettings, SmartAgent } from "../types";
import { Field } from "./Field";

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

interface LLMTabProps {
  settings: AppSettings;
  agents: SmartAgent[];
  onSave: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  onReset: () => void;
}

export function LLMTab({ settings, agents, onSave, onReset }: LLMTabProps) {
  return (
    <div className="space-y-3 panel-enter">
      <div className="flex items-center justify-between panel-enter">
        <div />
        <ResetButton onClick={onReset} />
      </div>

      <section className="panel-enter flex items-center justify-between">
        <span className="text-xs font-mono text-muted tracking-wider uppercase">LLM Post-Processing</span>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.llm_enabled}
            onChange={(e) => onSave("llm_enabled", e.target.checked)}
            className="accent-accent size-3.5"
          />
          <span className="text-xs text-muted font-mono">Enabled</span>
        </label>
      </section>

      {settings.llm_enabled && (
        <>
          <section className="panel-enter space-y-2.5">
            <Field label="Base URL" value={settings.llm_base_url} onChange={(v) => onSave("llm_base_url", v)} placeholder="http://localhost:11434/v1" />
            <Field label="API Key" value={settings.llm_api_key} onChange={(v) => onSave("llm_api_key", v)} placeholder="sk-..." password />
            <Field label="Model" value={settings.llm_model} onChange={(v) => onSave("llm_model", v)} placeholder="llama3.2" />
          </section>

          <section className="panel-enter">
            <div className="text-xs font-mono text-muted mb-3 tracking-wider uppercase">Smart Agents</div>
            {agents.map((agent) => (
              <div key={agent.name} className="mb-3 last:mb-0">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-xs font-mono text-ink">{agent.name}</span>
                  {agent.active && (
                    <span className="text-[10px] font-mono bg-accent/15 text-accent px-1.5 py-0.5 rounded-sm">active</span>
                  )}
                </div>
                <textarea
                  readOnly
                  value={agent.system_prompt}
                  className="w-full bg-elevated/50 rounded-md px-2.5 py-1.5 text-xs text-muted leading-relaxed h-18 resize-none outline-none ring-1 ring-stroke"
                />
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
