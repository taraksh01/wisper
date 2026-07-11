import { useState, useEffect, useRef } from "react";
import { AppSettings, SmartAgent, LLM_PROVIDERS } from "../types";
import { Select } from "./Select";
import { Field } from "./Field";
import { ResetButton } from "./ResetButton";
import { SectionCard } from "./SectionCard";
import { Switch } from "./Switch";

interface LLMTabProps {
  settings: AppSettings;
  agents: SmartAgent[];
  onSave: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  onSaveAll: (updates: Partial<AppSettings>) => void;
  onReset: () => void;
  onResetAgent?: () => void;
}

export function LLMTab({ settings, agents, onSave, onSaveAll, onReset, onResetAgent }: LLMTabProps) {
  const selectedProvider = LLM_PROVIDERS.find((p) => p.name === settings.llm_provider) ?? LLM_PROVIDERS[0];
  const [freeModels, setFreeModels] = useState<string[] | null>(null);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState("");

  const isOpenRouter = settings.llm_provider === "openrouter";
  const modelOptionsBase = isOpenRouter && freeModels
    ? freeModels
    : selectedProvider.models;
  const modelInList = settings.llm_model ? modelOptionsBase.includes(settings.llm_model) : false;

  const modelOptions = [
    ...modelOptionsBase.map((m) => ({ value: m, label: m })),
    { value: "__custom__", label: "Write your own..." },
  ];

  function handleProviderChange(name: string) {
    const provider = LLM_PROVIDERS.find((p) => p.name === name);
    if (!provider) return;
    setFreeModels(null);
    setFetchError("");
    const perProviderKey = `llm_api_key_${settings.llm_provider}` as keyof AppSettings;
    const updates: Partial<AppSettings> = {
      llm_provider: name,
      [perProviderKey]: settings.llm_api_key,
    };
    const newPerProviderKey = `llm_api_key_${name}` as keyof AppSettings;
    const newSavedKey = (settings[newPerProviderKey] as string) || "";
    updates.llm_api_key = newSavedKey;
    if (name !== "custom") {
      updates.llm_base_url = provider.base_url;
      if (provider.models.length > 0) {
        updates.llm_model = provider.models[0];
      }
    }
    onSaveAll(updates);
  }

  async function fetchOpenRouterFreeModels() {
    setFetching(true);
    setFetchError("");
    setFreeModels(null);
    try {
      const res = await fetch("https://openrouter.ai/api/v1/models");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const free = (data.data || [])
        .filter((m: any) =>
          m.pricing &&
          parseFloat(m.pricing.prompt ?? "1") === 0 &&
          parseFloat(m.pricing.completion ?? "1") === 0
        )
        .map((m: any) => m.id)
        .sort();
      if (free.length === 0) throw new Error("No free models found");
      setFreeModels(free);
      if (!free.includes(settings.llm_model)) {
        onSave("llm_model", free[0]);
      }
    } catch (err: any) {
      setFetchError(err.message ?? "Failed to fetch");
    } finally {
      setFetching(false);
    }
  }

  function handleModelChange(value: string) {
    if (value !== "__custom__") {
      onSave("llm_model", value);
    } else {
      onSave("llm_model", "");
    }
  }

  function handleModelInput(value: string) {
    onSave("llm_model", value);
  }

  return (
    <div className="max-w-lg space-y-4 card-enter">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9.75 3.104v5.714a2.25 2.25 0 0 1-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 0 1 4.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0 1 12 15a9.065 9.065 0 0 0-6.23.693L5 14.5m14.8.8 1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0 1 12 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
          </svg>
          <h1 className="text-sm font-bold font-mono text-ink tracking-tight">Process</h1>
        </div>
        <ResetButton onClick={onReset} />
      </div>

      <SectionCard className="card-enter">
        <div className="flex items-center justify-between">
          <h2 className="text-[10px] font-mono text-muted tracking-[0.12em] uppercase">LLM Post-Processing</h2>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted font-mono">Enabled</span>
            <Switch
              checked={settings.llm_enabled}
              onChange={(v) => onSave("llm_enabled", v)}
            />
          </div>
        </div>
      </SectionCard>

      {settings.llm_enabled && (
        <>
          <SectionCard title="Provider" className="card-enter space-y-3">
            <Select
              label="Provider"
              value={settings.llm_provider}
              options={LLM_PROVIDERS.map((p) => ({ value: p.name, label: p.label }))}
              onChange={handleProviderChange}
            />

            {settings.llm_provider !== "custom" && (
              <div>
                <label className="text-[11px] font-mono text-muted block mb-1 tracking-wider">Model</label>
                <div className="space-y-1.5">
                  {isOpenRouter && freeModels === null && !fetching && (
                    <button
                      onClick={fetchOpenRouterFreeModels}
                      className="w-full bg-elevated/50 rounded-md px-2.5 py-1.5 text-xs font-mono text-accent outline-none ring-1 ring-stroke hover:ring-accent/40 transition-all cursor-pointer text-left"
                    >
                      Fetch free models
                    </button>
                  )}
                  {isOpenRouter && fetching && (
                    <div className="text-xs font-mono text-muted px-2.5 py-1.5">Fetching free models...</div>
                  )}
                  {isOpenRouter && fetchError && (
                    <div className="text-xs font-mono text-red-400 px-2.5 py-1.5">{fetchError}</div>
                  )}
                  {(!isOpenRouter || freeModels !== null) && (
                    <>
                      <Select
                        value={modelInList ? settings.llm_model : "__custom__"}
                        options={modelOptions}
                        onChange={handleModelChange}
                      />
                      {(!modelInList || settings.llm_model === "") && (
                        <input
                          type="text"
                          value={settings.llm_model}
                          onChange={(e) => handleModelInput(e.target.value)}
                          placeholder="Type a model name..."
                          className="w-full bg-elevated/50 rounded-md px-2.5 py-1.5 text-xs font-mono text-ink placeholder:text-muted/50 outline-none ring-1 ring-stroke focus:ring-accent/50 transition-all"
                        />
                      )}
                    </>
                  )}
                </div>
              </div>
            )}

            {settings.llm_provider === "custom" && (
              <Field label="Model" value={settings.llm_model} onChange={(v) => onSave("llm_model", v)} placeholder="llama3.2" />
            )}

            <Field label="Base URL" value={settings.llm_base_url} onChange={(v) => onSave("llm_base_url", v)} placeholder="http://localhost:11434/v1" />

            <Field label="LLM API Key" value={settings.llm_api_key} onChange={(v) => onSave("llm_api_key", v)} placeholder="sk-..." secret />
          </SectionCard>

          <SectionCard title="Smart Agent" className="card-enter">
            {agents.map((agent) => (
              <div key={agent.name} className="mb-3 last:mb-0">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-xs font-mono text-ink">{agent.name}</span>
                  {agent.active && (
                    <span className="text-[10px] font-mono bg-accent/15 text-accent px-1.5 py-0.5 rounded-sm">active</span>
                  )}
                  {onResetAgent && (
                    <button
                      onClick={() => {
                        onSave("llm_agent_prompt", "");
                        onResetAgent!();
                      }}
                      className="ml-auto text-[10px] font-mono text-muted hover:text-accent transition-colors"
                    >
                      Reset
                    </button>
                  )}
                </div>
                <AutoTextarea
                  value={settings.llm_agent_prompt || agent.system_prompt}
                  onChange={(v) => onSave("llm_agent_prompt", v)}
                />
              </div>
            ))}
          </SectionCard>
        </>
      )}
    </div>
  );
}

function AutoTextarea({ value, onChange }: { value: string; onChange?: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, [value]);

  return (
    <textarea
      ref={ref}
      readOnly={!onChange}
      value={value}
      onChange={onChange ? (e) => onChange(e.target.value) : undefined}
      className="w-full bg-elevated/50 rounded-md px-2.5 py-1.5 text-xs text-muted leading-relaxed resize-none outline-none ring-1 ring-stroke min-h-[60px] focus:ring-accent/50 focus:text-ink transition-all"
    />
  );
}
