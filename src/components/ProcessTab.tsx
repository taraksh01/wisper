import { IconProcess, IconChevronDown } from "./ui/icons";
import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AppSettings, AgentProfile, PROCESS_PROVIDERS } from "../types";
import { Select } from "./Select";
import { Field } from "./Field";
import { ResetButton } from "./ResetButton";
import { SectionCard } from "./SectionCard";
import { Switch } from "./Switch";
import { Input } from "./ui/Input";
import { Textarea } from "./ui/Textarea";
import { Button } from "./ui/Button";
import { CostEstimatorModal } from "./CostEstimatorModal";

interface ProcessTabProps {
  settings: AppSettings;
  profiles: AgentProfile[];
  onSave: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  onSaveAll: (updates: Partial<AppSettings>) => void;
  onReset: () => void;
}

export function ProcessTab({ settings, profiles, onSave, onSaveAll, onReset }: ProcessTabProps) {
  const selectedProvider = PROCESS_PROVIDERS.find((p) => p.name === settings.process_provider) ?? PROCESS_PROVIDERS[0];
  const activeProfileId = settings.process_agent_profile || "auto";
  const selectedProfile = profiles.find((p) => p.id === activeProfileId);
  const isCustomProfile = activeProfileId === "custom";
  const [freeModels, setFreeModels] = useState<string[] | null>(null);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState("");
  const [showPrompt, setShowPrompt] = useState(false);
  const [testState, setTestState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [testMsg, setTestMsg] = useState("");
  const [showCostModal, setShowCostModal] = useState(false);

  const isOpenRouter = settings.process_provider === "openrouter";
  const modelOptionsBase = isOpenRouter && freeModels
    ? freeModels
    : selectedProvider.models;
  const modelInList = settings.process_model ? modelOptionsBase.includes(settings.process_model) : false;

  const modelOptions = [
    ...modelOptionsBase.map((m) => ({ value: m, label: m })),
    { value: "__custom__", label: "Write your own..." },
  ];

  const ENDPOINT_OPTIONS = [
    { value: "/chat/completions", label: "/chat/completions — OpenAI chat" },
    { value: "/responses", label: "/responses — OpenAI Responses" },
    { value: "/messages", label: "/messages — Anthropic" },
  ];

  function handleProviderChange(name: string) {
    const provider = PROCESS_PROVIDERS.find((p) => p.name === name);
    if (!provider) return;
    setFreeModels(null);
    setFetchError("");
    const perProviderKey = `process_api_key_${settings.process_provider}` as keyof AppSettings;
    const updates: Partial<AppSettings> = {
      process_provider: name,
      [perProviderKey]: settings.process_api_key,
    };
    const newPerProviderKey = `process_api_key_${name}` as keyof AppSettings;
    const newSavedKey = (settings[newPerProviderKey] as string) || "";
    updates.process_api_key = newSavedKey;
    if (name !== "custom") {
      updates.process_base_url = provider.base_url;
      updates.process_endpoint = (provider as any).endpoint || "/chat/completions";
      if (provider.models.length > 0) {
        updates.process_model = provider.models[0];
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
      if (!free.includes(settings.process_model)) {
        onSave("process_model", free[0]);
      }
    } catch (err: any) {
      setFetchError(err.message ?? "Failed to fetch");
    } finally {
      setFetching(false);
    }
  }

  function handleModelChange(value: string) {
    if (value !== "__custom__") {
      onSave("process_model", value);
    } else {
      onSave("process_model", "");
    }
  }

  function handleModelInput(value: string) {
    onSave("process_model", value);
  }

  const canTest =
    settings.process_base_url.trim() !== "" &&
    settings.process_api_key.trim() !== "" &&
    settings.process_model.trim() !== "";

  useEffect(() => {
    setTestState("idle");
    setTestMsg("");
  }, [settings.process_base_url, settings.process_api_key, settings.process_model, settings.process_endpoint]);

  async function handleTest() {
    setTestState("loading");
    setTestMsg("");
    try {
      const res = await invoke<string>("test_process_connection", {
        baseUrl: settings.process_base_url,
        apiKey: settings.process_api_key,
        model: settings.process_model,
        endpoint: settings.process_endpoint || "/chat/completions",
      });
      setTestState("success");
      setTestMsg(res);
    } catch (e: any) {
      setTestState("error");
      setTestMsg(typeof e === "string" ? e : e?.message ?? String(e));
    }
  }

  return (
    <div className="w-full space-y-3 card-enter">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <IconProcess className="w-5 h-5 text-accent" />
          <h1 className="text-sm font-semibold text-ink tracking-tight">Process</h1>
        </div>
        <ResetButton onClick={onReset} />
      </div>

      <SectionCard className="card-enter">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="label-soft">Polish with AI</h2>
            <p className="text-[11px] text-muted mt-1 leading-relaxed">
              Clean up filler words, punctuation and formatting before text is typed out.
            </p>
          </div>
          <Switch label="AI processing" checked={settings.process_enabled}
            onChange={(v) => onSave("process_enabled", v)}
          />
        </div>
      </SectionCard>

      {settings.process_enabled && (
        <>
          <SectionCard title="Writing Style" className="card-enter space-y-2 !p-3.5">
            <Select
              label="Profile"
              compact
              value={settings.process_agent_profile || "auto"}
              options={profiles.map((p) => ({ value: p.id, label: p.name }))}
              onChange={(v) => {
                setShowPrompt(false);
                onSave("process_agent_profile", v);
              }}
            />

            {selectedProfile && (
              <p className="text-[10px] font-mono text-muted/70 leading-tight line-clamp-2">
                {selectedProfile.description}
              </p>
            )}

            {isCustomProfile ? (
              <div>
                <label className="label-soft block mb-1.5">Your instructions</label>
                <AutoTextarea
                  value={settings.process_agent_prompt}
                  onChange={(v) => onSave("process_agent_prompt", v)}
                  placeholder="Describe how Wisper should rewrite your speech..."
                  onClear={settings.process_agent_prompt ? () => onSave("process_agent_prompt", "") : undefined}
                />
              </div>
            ) : (
              selectedProfile && selectedProfile.system_prompt && (
                <div className="rounded-lg bg-elevated/40 border border-stroke overflow-hidden">
                  <Button
                    variant="ghost"
                    onClick={() => setShowPrompt((v) => !v)}
                    className="w-full px-2.5 py-1.5 text-[10px] font-mono text-muted hover:text-ink justify-between gap-2"
                    aria-expanded={showPrompt}
                  >
                    <span>{showPrompt ? "Hide prompt" : "View prompt"}</span>
                    <IconChevronDown className={`w-3 h-3 transition-transform ${showPrompt ? "rotate-180" : ""}`} />
                  </Button>
                  {showPrompt && (
                    <div className="px-2 pb-2 pt-0">
                      <AutoTextarea value={selectedProfile.system_prompt} />
                    </div>
                  )}
                </div>
              )
            )}
          </SectionCard>

          <SectionCard title="Provider" className="card-enter space-y-3">
            <Select
              value={settings.process_provider}
              options={PROCESS_PROVIDERS.map((p) => ({ value: p.name, label: p.label }))}
              onChange={handleProviderChange}
            />

            {settings.process_provider === "custom" ? (
              <Field label="Model" value={settings.process_model} onChange={(v) => onSave("process_model", v)} placeholder="llama3.2" onClear={settings.process_model ? () => onSave("process_model", "") : undefined} />
            ) : (
              <div>
                <label className="label-soft block mb-1.5">Model</label>
                {isOpenRouter && freeModels === null && !fetching && (
                  <Button
                    variant="ghost"
                    onClick={fetchOpenRouterFreeModels}
                    className="w-full bg-elevated/50 rounded-lg px-2.5 py-2 text-xs font-mono text-accent ring-1 ring-stroke hover:ring-accent/40 text-left justify-start"
                  >
                    Fetch free models
                  </Button>
                )}
                {isOpenRouter && fetching && (
                  <div className="text-xs font-mono text-muted px-2.5 py-2 bg-elevated/50 rounded-lg">Fetching free models...</div>
                )}
                {isOpenRouter && fetchError && (
                  <div className="text-xs font-mono text-red-400 px-2.5 py-2 bg-elevated/50 rounded-lg">{fetchError}</div>
                )}
                {(!isOpenRouter || freeModels !== null) && (
                  <>
                    <Select
                      value={modelInList ? settings.process_model : "__custom__"}
                      options={modelOptions}
                      onChange={handleModelChange}
                    />
                    {(!modelInList || settings.process_model === "") && (
                      <Input
                        value={settings.process_model}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleModelInput(e.target.value)}
                        variant="surface"
                        placeholder="Type a model name..."
                        onClear={settings.process_model ? () => onSave("process_model", "") : undefined}
                        className="mt-1.5"
                      />
                    )}
                  </>
                )}
              </div>
            )}

            <Field label="Base URL" value={settings.process_base_url} onChange={(v) => onSave("process_base_url", v)} placeholder="http://localhost:11434/v1" onClear={settings.process_base_url ? () => onSave("process_base_url", "") : undefined} />
            <Select
              label="Endpoint"
              value={settings.process_endpoint || "/chat/completions"}
              options={ENDPOINT_OPTIONS}
              onChange={(v) => onSave("process_endpoint", v)}
            />
            <Field
              label="AI API Key"
              value={settings.process_api_key}
              onChange={(v) => onSave("process_api_key", v)}
              placeholder="sk-..."
              secret
              onClear={settings.process_api_key ? () => onSave("process_api_key", "") : undefined}
            />
            <div className="w-full">
              <Field
                label="Response length limit"
                type="number"
                value={settings.process_max_tokens === 0 ? "" : String(settings.process_max_tokens)}
                onChange={(v) => {
                  const n = parseInt(v, 10);
                  onSave("process_max_tokens", Number.isFinite(n) && n > 0 ? n : 0);
                }}
                placeholder="Auto (model default)"
                onClear={settings.process_max_tokens !== 0 ? () => onSave("process_max_tokens", 0) : undefined}
              />
              <p className="text-[10px] font-mono leading-relaxed mt-1.5">
                <span className="text-muted/50">0 or empty = model default (recommended).</span>
                {settings.process_max_tokens > 0 && settings.process_max_tokens < 512 && (
                  <span className="text-amber-400 ml-1">Low limits may fail with reasoning models — use ≥512 or leave empty.</span>
                )}
              </p>
            </div>
            <div className="w-full">
              <Field
                label="AI timeout (seconds)"
                type="number"
                value={String(settings.process_timeout_secs ?? 15)}
                onChange={(v) => {
                  const n = parseInt(v, 10);
                  onSave("process_timeout_secs", Number.isFinite(n) ? Math.min(120, Math.max(3, n)) : 15);
                }}
                placeholder="15"
                onClear={settings.process_timeout_secs !== 15 ? () => onSave("process_timeout_secs", 15) : undefined}
              />
              <p className="text-[10px] font-mono text-muted/50 leading-relaxed mt-1.5">Give up on AI refining after this many seconds and paste the raw transcript instead (3–120).</p>
            </div>
            <div className="w-full">
              <Field
                label="Minimum words for AI"
                type="number"
                value={settings.process_min_words === 0 ? "" : String(settings.process_min_words ?? 6)}
                onChange={(v) => {
                  if (v.trim() === "") {
                    onSave("process_min_words", 0);
                    return;
                  }
                  const n = parseInt(v, 10);
                  onSave("process_min_words", Number.isFinite(n) ? Math.min(20, Math.max(0, n)) : 6);
                }}
                placeholder="Always (0)"
                onClear={settings.process_min_words !== 6 ? () => onSave("process_min_words", 6) : undefined}
              />
              <p className="text-[10px] font-mono text-muted/50 leading-relaxed mt-1.5">Skip AI and paste raw text when the transcription has fewer than this many words — faster for short phrases like &quot;ok&quot; or &quot;yes please&quot; (empty = always run AI, 1–20, default 6).</p>
            </div>

            <div className="pt-1">
              <Button
                variant="ghost"
                onClick={handleTest}
                disabled={!canTest || testState === "loading"}
                aria-busy={testState === "loading"}
                className={`w-full rounded-lg px-3 py-2 text-xs font-medium border ${
                  !canTest || testState === "loading"
                    ? "bg-elevated/30 text-muted border-stroke cursor-not-allowed"
                    : testState === "success"
                      ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20 hover:bg-emerald-500/15"
                      : testState === "error"
                        ? "bg-red-500/10 text-red-600 border-red-500/20 hover:bg-red-500/15"
                        : "bg-surface border-stroke text-ink hover:border-accent/30 hover:bg-elevated/50"
                }`}
              >
                {testState === "loading" ? "Testing…" : testState === "success" ? "✓ Connected" : testState === "error" ? "Retry test" : "Test connection"}
              </Button>
              {testMsg && (
                <p className={`text-[11px] font-mono leading-relaxed mt-1.5 px-1 ${testState === "error" ? "text-red-500" : testState === "success" ? "text-emerald-600" : "text-muted"}`}>
                  {testMsg}
                </p>
              )}
              {!canTest && !testMsg && (
                <p className="text-[10px] font-mono text-muted/50 mt-1 px-1">Enter Base URL, API key and model to test.</p>
              )}
            </div>

            <Button
              variant="ghost"
              onClick={() => setShowCostModal(true)}
              className="w-full rounded-lg px-3 py-2 text-[11px] font-mono text-muted hover:text-accent border border-stroke hover:border-accent/30"
            >
              Estimate monthly AI cost
            </Button>
          </SectionCard>
          {showCostModal && <CostEstimatorModal onClose={() => setShowCostModal(false)} />}
        </>
      )}
    </div>
  );
}

function AutoTextarea({ value, onChange, placeholder, onClear }: { value: string; onChange?: (v: string) => void; placeholder?: string; onClear?: () => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, [value]);

  return (
    <Textarea
      ref={ref}
      readOnly={!onChange}
      value={value}
      placeholder={placeholder}
      onClear={onClear}
      onChange={onChange ? (e: React.ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value) : undefined}
      rows={1}
      className="min-h-0 overflow-hidden text-muted focus:text-ink"
    />
  );
}
