import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { DictionaryProfile, ProfileImportResult, ProfileUpdate } from "../types";
import { SectionCard } from "./SectionCard";
import { Switch } from "./Switch";
import { useToast } from "./ToastContext";

export function notifyWordsChanged() {
  window.dispatchEvent(new CustomEvent("wisper:words-changed"));
}

function downloadJson(filename: string, text: string) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function shortProfileId(id: string): string {
  return id.replace(/^wisper-/, "").replace(/-v\d+$/, "");
}

export function DictionaryProfiles() {
  const { addToast } = useToast();
  const [bundled, setBundled] = useState<DictionaryProfile[]>([]);
  const [imported, setImported] = useState<DictionaryProfile[]>([]);
  const [updates, setUpdates] = useState<ProfileUpdate[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [url, setUrl] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const [b, i] = await Promise.all([
        invoke<DictionaryProfile[]>("list_bundled_profiles"),
        invoke<DictionaryProfile[]>("list_imported_profiles"),
      ]);
      setBundled(b);
      setImported(i);
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function run(id: string, fn: () => Promise<unknown>, after?: () => void) {
    setBusy(id);
    try {
      await fn();
      await load();
      notifyWordsChanged();
      after?.();
    } catch (e: any) {
      addToast(String(e?.message ?? e), "error");
    } finally {
      setBusy(null);
    }
  }

  async function onImportBundled(p: DictionaryProfile) {
    await run(`import-${p.id}`, async () => {
      const r = await invoke<ProfileImportResult>("import_bundled_profile", { profileId: p.id });
      addToast(`${p.name}: +${r.added} new, ${r.updated} updated`, "success");
    });
  }

  async function onToggle(p: DictionaryProfile, active: boolean) {
    await run(`toggle-${p.id}`, async () => {
      await invoke("set_profile_active", { profileId: p.id, active });
      addToast(active ? `${p.name} enabled` : `${p.name} paused — ${p.entryCount} entries skipped`, "info");
    });
  }

  async function onRemove(p: DictionaryProfile) {
    if (!confirm(`Remove the "${p.name}" profile? ${p.entryCount} entries will be deleted (words you edited are kept).`)) return;
    await run(`remove-${p.id}`, async () => {
      const n = await invoke<number>("remove_profile", { profileId: p.id });
      addToast(`${p.name} removed (${n} entries)`, "success");
    });
  }

  async function onFilePicked(file: File) {
    const text = await file.text();
    await run("import-file", async () => {
      const r = await invoke<ProfileImportResult>("import_profile_from_json", { jsonText: text });
      addToast(`Imported ${r.profileId}: +${r.added} new, ${r.updated} updated`, "success");
    });
  }

  async function onImportUrl() {
    const u = url.trim();
    if (!u) return;
    await run("import-url", async () => {
      const r = await invoke<ProfileImportResult>("import_profile_from_url", { url: u });
      setUrl("");
      addToast(`Imported ${r.profileId}: +${r.added} new, ${r.updated} updated`, "success");
    });
  }

  async function onExport(p: DictionaryProfile) {
    try {
      const text = await invoke<string>("export_profile", { profileId: p.id });
      downloadJson(`${p.id}.json`, text);
      addToast(`${p.name} exported`, "success");
    } catch (e: any) {
      addToast(String(e?.message ?? e), "error");
    }
  }

  async function onExportMine() {
    try {
      const text = await invoke<string>("export_user_words");
      downloadJson("wisper-my-words.json", text);
      addToast("Your words exported", "success");
    } catch (e: any) {
      addToast(String(e?.message ?? e), "error");
    }
  }

  async function onCheckUpdates() {
    setChecking(true);
    try {
      const u = await invoke<ProfileUpdate[]>("check_profile_updates");
      setUpdates(u);
      addToast(u.length === 0 ? "All profiles are up to date" : `${u.length} update${u.length !== 1 ? "s" : ""} available`, u.length === 0 ? "info" : "success");
    } catch (e: any) {
      addToast(String(e?.message ?? e), "error");
    } finally {
      setChecking(false);
    }
  }

  async function onApplyUpdate(u: ProfileUpdate) {
    await run(`update-${u.profileId}`, async () => {
      const r = await invoke<ProfileImportResult>("import_profile_from_url", { url: u.url });
      setUpdates((prev) => prev.filter((x) => x.profileId !== u.profileId));
      addToast(`${u.name} updated to v${u.latestVersion} (+${r.added}, ${r.updated} updated)`, "success");
    });
  }

  const customProfiles = imported.filter((p) => p.source !== "bundled");

  return (
    <div className="space-y-3">
      <SectionCard className="card-enter">
        <div>
          <h2 className="label-soft">Dictionary profiles</h2>
          <p className="text-[11px] text-muted mt-1 leading-relaxed">
            Ready-made word packs for your kind of work. Import one, pause it anytime, or share your own as a file.
          </p>
        </div>

        <div className="space-y-1.5 mt-3">
          {bundled.map((p) => (
            <div
              key={p.id}
              className="flex items-center gap-2 bg-elevated/30 rounded-lg px-2.5 py-2 ring-1 ring-stroke/60"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-ink">{p.name}</span>
                  <span className="text-[9px] font-mono text-muted/70">
                    {p.imported ? `${p.entryCount} / ${p.bundledEntryCount} entries` : `${p.entryCount} terms`} · v{p.version}
                    {p.hasUpdate && <span className="ml-1 text-amber-500">· update available</span>}
                  </span>
                </div>
                {p.description && (
                  <p className="text-[10px] font-mono text-muted truncate" title={p.description}>
                    {p.description}
                  </p>
                )}
              </div>
              <div className="ml-auto flex items-center gap-2 shrink-0">
                {p.imported ? (
                  <>
                    {p.hasUpdate && (
                      <button
                        onClick={() => onImportBundled(p)}
                        disabled={busy === `import-${p.id}`}
                        className="text-[10px] font-mono bg-accent/15 text-accent hover:bg-accent/25 rounded px-2 py-1 transition-colors cursor-pointer disabled:opacity-40"
                        title={`Update available: ${p.bundledEntryCount} terms in latest (you have ${p.entryCount})`}
                      >
                        {busy === `import-${p.id}` ? "Updating…" : `Update · +${Math.max(0, p.bundledEntryCount - p.entryCount)} new`}
                      </button>
                    )}
                    <Switch
                      label={`${p.name} active`}
                      checked={p.active}
                      onChange={(v) => onToggle(p, v)}
                    />
                    <button
                      onClick={() => onExport(p)}
                      className="text-[10px] font-mono text-muted hover:text-ink transition-colors cursor-pointer"
                    >
                      Export
                    </button>
                    <button
                      onClick={() => onRemove(p)}
                      disabled={busy === `remove-${p.id}`}
                      className="text-[10px] font-mono text-muted hover:text-red-400 transition-colors cursor-pointer disabled:opacity-40"
                    >
                      Remove
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => onImportBundled(p)}
                    disabled={busy === `import-${p.id}`}
                    className="text-[10px] font-mono text-accent hover:text-accent/80 transition-colors cursor-pointer disabled:opacity-40"
                  >
                    {busy === `import-${p.id}` ? "Adding…" : "Add"}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard className="card-enter">
        <div>
          <h2 className="label-soft">Share profiles</h2>
          <p className="text-[11px] text-muted mt-1 leading-relaxed">
            Import a profile file someone shared with you, or export your own words to share.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) onFilePicked(f);
            }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy === "import-file"}
            className="bg-elevated/50 text-ink rounded-md px-3 py-1.5 text-xs font-mono ring-1 ring-stroke hover:ring-accent/40 disabled:opacity-60 transition-all cursor-pointer"
          >
            {busy === "import-file" ? "Importing…" : "Import from file…"}
          </button>
          <button
            onClick={onExportMine}
            className="bg-elevated/50 text-ink rounded-md px-3 py-1.5 text-xs font-mono ring-1 ring-stroke hover:ring-accent/40 transition-all cursor-pointer"
          >
            Export my words…
          </button>
          <button
            onClick={onCheckUpdates}
            disabled={checking}
            className="bg-elevated/50 text-ink rounded-md px-3 py-1.5 text-xs font-mono ring-1 ring-stroke hover:ring-accent/40 disabled:opacity-60 transition-all cursor-pointer"
          >
            {checking ? "Checking…" : "Check for updates"}
          </button>
        </div>
        <div className="flex gap-2 mt-2">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onImportUrl()}
            placeholder="https://…/profile.json"
            aria-label="Profile URL"
            className="flex-1 min-w-0 bg-elevated/30 rounded-md px-2.5 py-1.5 text-xs font-mono text-ink placeholder:text-muted/40 ring-1 ring-stroke/60 focus:outline-none focus:ring-accent/50"
          />
          <button
            onClick={onImportUrl}
            disabled={!url.trim() || busy === "import-url"}
            className="bg-accent/15 text-accent rounded-md px-3 py-1.5 text-xs font-mono hover:bg-accent/25 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer"
          >
            {busy === "import-url" ? "Fetching…" : "Add URL"}
          </button>
        </div>

        {customProfiles.length > 0 && (
          <div className="space-y-1.5 mt-3 pt-3 border-t border-stroke/30">
            <p className="text-[9px] font-mono text-muted tracking-[0.12em] uppercase">Imported</p>
            {customProfiles.map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-2 bg-elevated/30 rounded-lg px-2.5 py-2 ring-1 ring-stroke/60"
              >
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-mono text-ink">{p.name}</span>
                  <span className="text-[9px] font-mono text-muted/70 ml-2">
                    {p.entryCount} entries · {p.source}
                  </span>
                </div>
                <div className="ml-auto flex items-center gap-2 shrink-0">
                  <Switch label={`${p.name} active`} checked={p.active} onChange={(v) => onToggle(p, v)} />
                  <button
                    onClick={() => onExport(p)}
                    className="text-[10px] font-mono text-muted hover:text-ink transition-colors cursor-pointer"
                  >
                    Export
                  </button>
                  <button
                    onClick={() => onRemove(p)}
                    className="text-[10px] font-mono text-muted hover:text-red-400 transition-colors cursor-pointer"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {updates.length > 0 && (
          <div className="space-y-1.5 mt-3 pt-3 border-t border-stroke/30">
            <p className="text-[9px] font-mono text-muted tracking-[0.12em] uppercase">Updates available</p>
            {updates.map((u) => (
              <div
                key={u.profileId}
                className="flex items-center gap-2 bg-accent/5 rounded-lg px-2.5 py-2 ring-1 ring-accent/30"
              >
                <span className="text-xs font-mono text-ink flex-1 truncate">
                  {u.name} <span className="text-muted">v{u.currentVersion} → v{u.latestVersion}</span>
                </span>
                <button
                  onClick={() => onApplyUpdate(u)}
                  disabled={busy === `update-${u.profileId}`}
                  className="text-[10px] font-mono text-accent hover:text-accent/80 transition-colors cursor-pointer disabled:opacity-40 shrink-0"
                >
                  {busy === `update-${u.profileId}` ? "Updating…" : "Update"}
                </button>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

export { shortProfileId };
