import { useState } from "react";
import { AppSettings, modelCatalog, allModelKeys, languages, formatModelFilename } from "../types";
import ModelCard from "./ModelCard";
import { Select } from "./Select";

interface STTTabProps {
  settings: AppSettings;
  localModels: string[];
  downloading: string | null;
  downloadProgress: Record<string, number>;
  modelsPath: string;
  modelLangFilter: string;
  modelSearchQuery: string;
  onSave: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  onSaveAll: (updates: Partial<AppSettings>) => void;
  onDownload: (name: string) => void;
  onDelete: (name: string) => void;
  onLangFilterChange: (v: string) => void;
  onSearchQueryChange: (v: string) => void;
}

const langOptions = [{ value: "all", label: "All languages" }, ...languages.filter((l) => l.value !== "auto")];

function sortKeys(keys: string[]) {
  return keys.sort((a, b) => {
    const ai = modelCatalog[a], bi = modelCatalog[b];
    const recA = ai.recommended ? 1 : 0, recB = bi.recommended ? 1 : 0;
    if (recA !== recB) return recB - recA;
    if (ai.accuracy !== bi.accuracy) return bi.accuracy - ai.accuracy;
    return bi.speed - ai.speed;
  });
}

export function STTTab({
  settings,
  localModels,
  downloading,
  downloadProgress,
  modelsPath,
  modelLangFilter,
  modelSearchQuery,
  onSave,
  onSaveAll,
  onDownload,
  onDelete,
  onLangFilterChange,
  onSearchQueryChange,
}: STTTabProps) {
  const isLocal = settings.stt_mode === "local";

  const filtered = allModelKeys
    .filter((key) => modelLangFilter === "all" || modelCatalog[key].languages.includes(modelLangFilter))
    .filter((key) => !modelSearchQuery || key.toLowerCase().includes(modelSearchQuery.toLowerCase()) || modelCatalog[key].name.toLowerCase().includes(modelSearchQuery.toLowerCase()));

  const downloadedKeys = sortKeys(
    filtered.filter((k) => localModels.includes(formatModelFilename(k, modelCatalog[k].format)))
  );
  const availableKeys = sortKeys(
    filtered.filter((k) => !downloadedKeys.includes(k))
  );

  return (
    <div className="flex flex-col h-full panel-enter">

      <div className="relative bg-elevated/40 rounded-xl p-1 flex mb-6 panel-enter">
        <div
          className={`absolute top-1 bottom-1 w-1/2 rounded-lg bg-accent transition-all duration-300 ease-out ${
            isLocal ? "left-1" : "left-[calc(50%-2px)]"
          }`}
        />
        {(["local", "cloud"] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => onSave("stt_mode", mode)}
            className={`relative z-10 flex-1 py-2.5 text-xs font-mono font-medium rounded-lg transition-colors duration-200 ${
              settings.stt_mode === mode
                ? "text-white"
                : "text-muted hover:text-ink"
            }`}
          >
            {mode === "local" ? "Local Engine" : "Cloud API"}
          </button>
        ))}
      </div>

      <div className="relative flex-1">
        <div
          className={`transition-all duration-300 ease-out ${
            isLocal
              ? "opacity-100 translate-y-0"
              : "opacity-0 translate-y-2 pointer-events-none absolute inset-0"
          }`}
        >
          <div className="space-y-4">
            <p className="text-[10px] text-muted">Stored at <span className="text-ink">{modelsPath}</span></p>
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="relative flex-1">
                  <svg className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted/50 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <circle cx="11" cy="11" r="7" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="m20 20-4.35-4.35" />
                  </svg>
                  <input
                    type="text"
                    value={modelSearchQuery}
                    onChange={(e) => onSearchQueryChange(e.target.value)}
                    placeholder="Search model by name..."
                    className="w-full text-[10px] font-mono bg-elevated/50 rounded-md pl-7 pr-2 py-1.5 text-muted placeholder:text-muted/40 outline-none ring-1 ring-stroke focus:ring-accent/40 transition-all"
                  />
                </div>
                <div className="w-36 shrink-0">
                  <Select
                    value={modelLangFilter}
                    options={langOptions}
                    onChange={(v) => onLangFilterChange(v)}
                  />
                </div>
              </div>

              <>
                {downloadedKeys.length > 0 && (
                  <div className="mb-5">
                    <div className="text-xs font-mono text-muted tracking-wider uppercase mb-3">
                      <span>Downloaded</span>
                      <span className="tabular-nums text-muted/60 ml-1">({downloadedKeys.length})</span>
                    </div>
                    <div className="grid grid-cols-1 gap-2">
                      {downloadedKeys.map((key) => {
                        const info = modelCatalog[key];
                        const filename = formatModelFilename(key, info.format);
                        return (
                          <ModelCard
                            key={key}
                            modelKey={key}
                            info={info}
                            isInstalled
                            isActive={settings.local_model_file === filename}
                            isDownloading={false}
                            onActivate={(f) => onSave("local_model_file", f)}
                            onDownload={() => {}}
                            onDelete={(f) => onDelete(f)}
                          />
                        );
                      })}
                    </div>
                  </div>
                )}
                <div>
                  <div className="text-xs font-mono text-muted tracking-wider uppercase mb-3">
                    <span>Available to Download</span>
                    <span className="tabular-nums text-muted/60 ml-1">({availableKeys.length})</span>
                  </div>
                  <div className="grid grid-cols-1 gap-2">
                    {availableKeys.length > 0 ? availableKeys.map((key) => {
                      const info = modelCatalog[key];
                      return (
                        <ModelCard
                          key={key}
                          modelKey={key}
                          info={info}
                          isInstalled={false}
                          isActive={false}
                          isDownloading={downloading === key}
                          progress={downloadProgress[key]}
                          onActivate={() => {}}
                          onDownload={(k) => onDownload(k)}
                          onDelete={() => {}}
                        />
                      );
                    }) : (
                      <p className="text-xs text-muted">No models match your filters.</p>
                    )}
                  </div>
                </div>
              </>
            </div>
          </div>
        </div>

        <div
          className={`transition-all duration-300 ease-out ${
            !isLocal
              ? "opacity-100 translate-y-0"
              : "opacity-0 translate-y-2 pointer-events-none absolute inset-0"
          }`}
        >
          <div className="space-y-4">
            <div>
              <label className="text-[11px] font-mono text-muted block mb-1.5 tracking-wider">Provider</label>
              <div className="relative bg-elevated/40 rounded-xl p-1 flex mb-4">
                <div
                  className={`absolute top-1 bottom-1 w-1/3 rounded-lg bg-accent transition-all duration-300 ease-out ${
                    settings.stt_provider === "openai" ? "left-1" :
                    settings.stt_provider === "groq" ? "left-1/3" :
                    "left-2/3"
                  }`}
                />
                {[
                  { id: "openai", label: "OpenAI" },
                  { id: "groq", label: "Groq" },
                  { id: "custom", label: "Custom" },
                ].map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      const keyField = `voice_api_key_${p.id}` as keyof AppSettings;
                      const updates: Partial<AppSettings> = { 
                        stt_provider: p.id,
                        voice_api_key: settings[keyField] as string || "",
                      };
                      if (p.id === "openai") {
                        updates.stt_model = "whisper-1";
                        updates.stt_base_url = "";
                      } else if (p.id === "groq") {
                        updates.stt_model = "whisper-large-v3";
                        updates.stt_base_url = "https://api.groq.com/openai/v1";
                      }
                      onSaveAll(updates);
                    }}
                    className={`relative z-10 flex-1 py-2.5 text-xs font-mono font-medium rounded-lg transition-colors duration-200 ${
                      settings.stt_provider === p.id
                        ? "text-white"
                        : "text-muted hover:text-ink"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <Field label="Voice API Key" value={settings.voice_api_key} onChange={(v) => {
              const perProviderKey = `voice_api_key_${settings.stt_provider}` as keyof AppSettings;
              onSaveAll({ voice_api_key: v, [perProviderKey]: v });
            }} placeholder="sk-..." secret />

            <div className="relative">
              {(["openai", "groq", "custom"] as const).map((provider) => (
                <div
                  key={provider}
                  className={`transition-all duration-300 ease-out ${
                    settings.stt_provider === provider
                      ? "opacity-100 translate-y-0"
                      : "opacity-0 translate-y-2 pointer-events-none absolute inset-0"
                  }`}
                >
                  {provider === "openai" && (
                    <Select label="Model" value={settings.stt_model} options={[{ value: "whisper-1", label: "whisper-1" }]} onChange={(v) => onSave("stt_model", v)} />
                  )}
                  {provider === "groq" && (
                    <Select label="Model" value={settings.stt_model} options={["whisper-large-v3", "whisper-large-v3-turbo"].map((m) => ({ value: m, label: m }))} onChange={(v) => onSave("stt_model", v)} />
                  )}
                  {provider === "custom" && (
                    <>
                      <Field label="Base URL" value={settings.stt_base_url} onChange={(v) => onSave("stt_base_url", v)} placeholder="https://api.openai.com/v1" />
                      <div className="mt-3">
                        <Field label="Model" value={settings.stt_model} onChange={(v) => onSave("stt_model", v)} placeholder="whisper-1" />
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="border-t border-stroke pt-4 mt-4 panel-enter">
        <label className="flex items-center gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={settings.vad_enabled}
            onChange={(e) => onSave("vad_enabled", e.target.checked)}
            className="accent-accent size-3.5 shrink-0"
          />
          <span className="text-xs text-muted">Trim silence from recordings</span>
        </label>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  secret,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  secret?: boolean;
}) {
  const [show, setShow] = useState(true);
  return (
    <div>
      <label className="text-[11px] font-mono text-muted block mb-1 tracking-wider">{label}</label>
      <div className="relative">
        <input
          type={secret && !show ? "password" : "text"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-elevated/50 rounded-md px-2.5 py-1.5 text-xs font-mono text-ink placeholder:text-muted/50 outline-none ring-1 ring-stroke focus:ring-accent/50 transition-all pr-8"
          placeholder={placeholder}
        />
        {secret && (
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); setShow(!show); }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-ink transition-colors"
          >
            {show ? (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
