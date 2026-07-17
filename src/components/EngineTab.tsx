import { AppSettings, modelCatalog, allModelKeys, languages, formatModelFilename } from "../types";
import ModelCard from "./ModelCard";
import { Select } from "./Select";
import { Field } from "./Field";
import { SectionCard } from "./SectionCard";

interface EngineTabProps {
  settings: AppSettings;
  localModels: string[];
  downloading: string | null;
  downloadProgress: Record<string, number>;
  justDownloaded?: string;
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

export function EngineTab({
  settings,
  localModels,
  downloading,
  downloadProgress,
  justDownloaded,
  modelsPath,
  modelLangFilter,
  modelSearchQuery,
  onSave,
  onSaveAll,
  onDownload,
  onDelete,
  onLangFilterChange,
  onSearchQueryChange,
}: EngineTabProps) {
  const isLocal = settings.engine_mode === "local";

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
    <div className="max-w-lg space-y-4 card-enter">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
          <h1 className="text-sm font-semibold text-ink tracking-tight">Engine</h1>
        </div>
      </div>

      <SectionCard className="card-enter">
        <div className="relative bg-elevated/40 rounded-xl p-1 flex">
          <div className={`absolute top-1 bottom-1 w-1/2 rounded-lg bg-accent transition-all duration-300 ease-out ${isLocal ? "left-1" : "left-[calc(50%-2px)]"}`} />
          {(["local", "cloud"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => onSave("engine_mode", mode)}
              className={`relative z-10 flex-1 py-2.5 text-xs font-mono font-medium rounded-lg transition-colors duration-200 ${settings.engine_mode === mode ? "text-white" : "text-muted hover:text-ink"}`}
            >
              {mode === "local" ? "Local Engine" : "Cloud API"}
            </button>
          ))}
        </div>
      </SectionCard>

      {isLocal ? (
        <>
          <SectionCard className="card-enter">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <svg className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted/50 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <circle cx="11" cy="11" r="7" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="m20 20-4.35-4.35" />
                </svg>
                <input
                  type="text"
                  value={modelSearchQuery}
                  onChange={(e) => onSearchQueryChange(e.target.value)}
                  placeholder="Search model..."
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
            <p className="text-[10px] text-muted mt-3">Stored at <span className="text-ink">{modelsPath}</span></p>
          </SectionCard>

          {downloadedKeys.length > 0 && (
            <SectionCard title={`Downloaded (${downloadedKeys.length})`} className="card-enter">
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
                      justDownloaded={justDownloaded === filename}
                      onActivate={(f) => onSave("local_model_file", f)}
                      onDownload={() => {}}
                      onDelete={(f) => onDelete(f)}
                    />
                  );
                })}
              </div>
            </SectionCard>
          )}

          {availableKeys.length > 0 && (
            <SectionCard title={`Available to Download (${availableKeys.length})`} className="card-enter">
              <div className="grid grid-cols-1 gap-2">
                {availableKeys.map((key) => {
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
                      justDownloaded={justDownloaded === key}
                      onActivate={() => {}}
                      onDownload={(k) => onDownload(k)}
                      onDelete={() => {}}
                    />
                  );
                })}
              </div>
            </SectionCard>
          )}

          {availableKeys.length === 0 && downloadedKeys.length === 0 && (
            <SectionCard className="card-enter">
              <div className="flex flex-col items-center justify-center text-center py-6 px-4">
                <svg className="w-7 h-7 text-muted/50 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="7" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="m20 20-4.35-4.35" />
                </svg>
                <p className="text-xs text-muted">No models match your filters.</p>
              </div>
            </SectionCard>
          )}
        </>
      ) : (
        <>
          <SectionCard title="Provider" className="card-enter">
            <div className="relative bg-elevated/40 rounded-xl p-1 flex mb-4">
              <div className={`absolute top-1 bottom-1 w-1/3 rounded-lg bg-accent transition-all duration-300 ease-out ${
                settings.engine_provider === "openai" ? "left-1" :
                settings.engine_provider === "groq" ? "left-1/3" :
                "left-2/3"
              }`} />
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
                      engine_provider: p.id,
                      voice_api_key: settings[keyField] as string || "",
                    };
                    if (p.id === "openai") {
                      updates.engine_model = "whisper-1";
                      updates.engine_base_url = "";
                    } else if (p.id === "groq") {
                      updates.engine_model = "whisper-large-v3";
                      updates.engine_base_url = "https://api.groq.com/openai/v1";
                    }
                    onSaveAll(updates);
                  }}
                  className={`relative z-10 flex-1 py-2.5 text-xs font-mono font-medium rounded-lg transition-colors duration-200 ${settings.engine_provider === p.id ? "text-white" : "text-muted hover:text-ink"}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <Field label="Voice API Key" value={settings.voice_api_key} onChange={(v) => {
              const perProviderKey = `voice_api_key_${settings.engine_provider}` as keyof AppSettings;
              onSaveAll({ voice_api_key: v, [perProviderKey]: v });
            }} placeholder="sk-..." secret />
          </SectionCard>

          <SectionCard title="Model" className="card-enter">
            {(["openai", "groq", "custom"] as const).map((provider) => (
              <div key={provider} className={settings.engine_provider === provider ? "space-y-3" : "hidden"}>
                {provider === "openai" && (
                  <Select label="Model" value={settings.engine_model} options={[{ value: "whisper-1", label: "whisper-1" }]} onChange={(v) => onSave("engine_model", v)} />
                )}
                {provider === "groq" && (
                  <Select label="Model" value={settings.engine_model} options={["whisper-large-v3", "whisper-large-v3-turbo"].map((m) => ({ value: m, label: m }))} onChange={(v) => onSave("engine_model", v)} />
                )}
                {provider === "custom" && (
                  <>
                    <Field label="Base URL" value={settings.engine_base_url} onChange={(v) => onSave("engine_base_url", v)} placeholder="https://api.openai.com/v1" />
                    <Field label="Model" value={settings.engine_model} onChange={(v) => onSave("engine_model", v)} placeholder="whisper-1" />
                  </>
                )}
              </div>
            ))}
          </SectionCard>
        </>
      )}

    </div>
  );
}
