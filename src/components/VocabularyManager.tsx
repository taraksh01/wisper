import { useState, useEffect, useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import { VocabEntry, VocabSuggestion } from "../types";
import { SectionCard } from "./SectionCard";

interface VocabularyManagerProps {
  suggestions: VocabSuggestion[];
  scanning: boolean;
  scanMsg: string;
  onScan: () => void;
  setSuggestions: Dispatch<SetStateAction<VocabSuggestion[]>>;
}

export function VocabularyManager({ suggestions, scanning, scanMsg, onScan, setSuggestions }: VocabularyManagerProps) {
  const [entries, setEntries] = useState<VocabEntry[]>([]);
  const [phrase, setPhrase] = useState("");
  const [variants, setVariants] = useState("");
  const [error, setError] = useState("");
  const [ignored, setIgnored] = useState<string[]>([]);
  const [showImport, setShowImport] = useState(false);

  const load = useCallback(async () => {
    try {
      const v = await invoke<VocabEntry[]>("get_vocabulary");
      setEntries(v);
    } catch (e) {
      console.error(e);
    }
  }, []);

  const loadIgnored = useCallback(async () => {
    try {
      const list = await invoke<string[]>("get_ignored_terms");
      setIgnored(list);
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    load();
    loadIgnored();
  }, [load, loadIgnored]);

  async function addEntry() {
    if (!phrase.trim()) return;
    setError("");
    try {
      await invoke("add_vocab_entry", {
        phrase: phrase.trim(),
        variants: variants.trim(),
        caseSensitive: false,
        wholeWord: true,
        auto: false,
      });
      setPhrase("");
      setVariants("");
      await load();
    } catch (e: any) {
      setError(String(e));
    }
  }

  async function removeEntry(id: number) {
    try {
      await invoke("delete_vocab_entry", { id });
      await load();
    } catch (e) {
      console.error(e);
    }
  }

  async function acceptSuggestion(s: VocabSuggestion) {
    try {
      await invoke("add_vocab_entry", {
        phrase: s.phrase,
        variants: s.variants.join(", "),
        caseSensitive: false,
        wholeWord: true,
        auto: true,
      });
      setSuggestions((prev) => prev.filter((x) => x.phrase !== s.phrase));
      await load();
    } catch (e) {
      console.error(e);
    }
  }

  function updateSuggestion(index: number, patch: Partial<VocabSuggestion>) {
    setSuggestions((prev) => prev.map((x, i) => (i === index ? { ...x, ...patch } : x)));
  }

  async function dismissSuggestion(s: VocabSuggestion) {
    try {
      await invoke("ignore_vocab_suggestion", { term: s.phrase });
    } catch (e) {
      console.error(e);
    }
    setSuggestions((prev) => prev.filter((x) => x.phrase !== s.phrase));
    loadIgnored();
  }

  async function addIgnoredToDictionary(term: string) {
    try {
      await invoke("add_ignored_to_dictionary", { term });
      await loadIgnored();
      await load();
    } catch (e) {
      console.error(e);
    }
  }

  async function unignore(term: string) {
    try {
      await invoke("unignore_vocab_term", { term });
      await loadIgnored();
    } catch (e) {
      console.error(e);
    }
  }

  const handleImport = async (paste: string) => {
    const lines = paste.trim().split(/\r?\n/).filter(Boolean);
    let added = 0, skipped = 0;
    for (const line of lines) {
      try {
        const [phrase, variants] = line.split("|").map(s => s.trim());
        if (!phrase) continue;
        await invoke("add_vocab_entry", {
          phrase,
          variants: variants || "",
          caseSensitive: false,
          wholeWord: true,
          auto: false,
        });
        added++;
      } catch (e) {
        if (String(e).includes("UNIQUE")) skipped++;
        else console.error(e);
      }
    }
    await load();
    return { added, skipped };
  };

  return (
    <div className="space-y-4">
      <SectionCard className="sticky top-0 z-10 card-enter">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-[10px] font-mono text-muted tracking-[0.12em] uppercase">Scan history</h2>
            <p className="text-[11px] text-muted mt-1 leading-relaxed">
              Scan your dictations for recurring names and terms, then approve the spelling Wisper should use.
            </p>
          </div>
          <button
            onClick={onScan}
            disabled={scanning}
            className="shrink-0 flex items-center gap-1.5 bg-elevated/50 text-accent rounded-md px-3 py-1.5 text-xs font-mono ring-1 ring-stroke hover:ring-accent/40 disabled:opacity-60 disabled:cursor-not-allowed transition-all cursor-pointer"
          >
            {scanning && (
              <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            {scanning ? "Scanning…" : "Scan history"}
          </button>
        </div>

        {scanMsg && <p className="text-[10px] font-mono text-muted mt-2">{scanMsg}</p>}

        {suggestions.length > 0 && (
          <div className="mt-2 space-y-1 max-h-44 overflow-y-auto custom-scrollbar pr-0.5">
            {suggestions.map((s, i) => (
              <div
                key={i}
                className="flex items-center gap-2 bg-elevated/30 rounded-md px-2.5 py-1.5 ring-1 ring-stroke/60"
              >
                <input
                  value={s.phrase}
                  onChange={(e) => updateSuggestion(i, { phrase: e.target.value })}
                  placeholder="Correct spelling"
                  className="text-xs font-mono text-ink bg-transparent outline-none w-28 shrink-0 placeholder:text-muted/50"
                />
                <span className="text-[10px] font-mono text-muted/60 shrink-0">←</span>
                <input
                  value={s.variants.join(", ")}
                  onChange={(e) =>
                    updateSuggestion(i, {
                      variants: e.target.value.split(",").map((v) => v.trim()).filter(Boolean),
                    })
                  }
                  placeholder="misheard, forms"
                  className="text-[10px] font-mono text-muted bg-transparent outline-none flex-1 min-w-0 placeholder:text-muted/40"
                />
                <div className="ml-auto flex items-center gap-2 shrink-0">
                  {s.count > 0 && <span className="text-[9px] font-mono text-muted">{s.count}×</span>}
                  <button
                    onClick={() => acceptSuggestion(s)}
                    className="text-[10px] font-mono text-accent hover:text-accent/80 transition-colors cursor-pointer"
                  >
                    Add
                  </button>
                  <button
                    onClick={() => dismissSuggestion(s)}
                    className="text-[10px] font-mono text-muted hover:text-ink transition-colors cursor-pointer"
                  >
                    Skip
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Dictionary" className="card-enter space-y-3">
        <p className="text-[11px] text-muted leading-relaxed">
          Force your spelling for names, brands, and technical terms. Wisper rewrites the misheard
          forms to your canonical version — e.g. <span className="text-ink font-mono">whisper</span> →{" "}
          <span className="text-ink font-mono">Wisper</span>.
        </p>

        <div className="space-y-1.5">
          <input
            type="text"
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addEntry()}
            placeholder="Correct spelling (e.g. Wisper)"
            className="w-full bg-elevated/50 rounded-md px-2.5 py-1.5 text-xs font-mono text-ink placeholder:text-muted/50 outline-none ring-1 ring-stroke focus:ring-accent/50 transition-all"
          />
          <input
            type="text"
            value={variants}
            onChange={(e) => setVariants(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addEntry()}
            placeholder="Misheard forms, comma separated (e.g. whisper, wispr)"
            className="w-full bg-elevated/50 rounded-md px-2.5 py-1.5 text-xs font-mono text-ink placeholder:text-muted/50 outline-none ring-1 ring-stroke focus:ring-accent/50 transition-all"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={addEntry}
              disabled={!phrase.trim()}
              className="bg-accent/15 text-accent rounded-md px-3 py-1.5 text-xs font-mono hover:bg-accent/25 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer"
            >
              Add term
            </button>
            {error && <span className="text-[10px] font-mono text-red-400">{error}</span>}
          </div>
        </div>

        <div className="pt-2 border-t border-stroke/30">
          <button
            onClick={() => setShowImport(true)}
            className="w-full bg-elevated/30 text-muted hover:text-ink hover:bg-elevated/50 rounded-md px-3 py-1.5 text-xs font-mono transition-all cursor-pointer"
          >
            Import multiple terms…
          </button>
        </div>

        {showImport && (
          <ImportModal onClose={() => setShowImport(false)} onImport={handleImport} />
        )}

        {entries.length > 0 && (
          <div className="space-y-1 pt-1">
            {entries.map((e) => (
              <div
                key={e.id}
                className="flex items-center gap-2 bg-elevated/30 rounded-md px-2.5 py-1.5 ring-1 ring-stroke/60"
              >
                <span className="text-xs font-mono text-ink shrink-0">{e.phrase}</span>
                {e.variants && (
                  <span className="text-[10px] font-mono text-muted truncate" title={e.variants}>
                    ← {e.variants}
                  </span>
                )}
                <div className="ml-auto flex items-center gap-2 shrink-0">
                  {e.auto && (
                    <span className="text-[9px] font-mono bg-accent/10 text-accent/80 px-1.5 py-0.5 rounded-sm">
                      auto
                    </span>
                  )}
                  {e.hits > 0 && (
                    <span className="text-[9px] font-mono text-muted" title="Times applied">
                      {e.hits}×
                    </span>
                  )}
                  <button
                    onClick={() => removeEntry(e.id)}
                    className="text-muted hover:text-red-400 transition-colors cursor-pointer"
                    title="Delete"
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {ignored.length > 0 && (
          <div className="space-y-1 pt-1">
            <p className="text-[9px] font-mono text-muted tracking-[0.12em] uppercase">Ignored</p>
            {ignored.map((term) => (
              <div
                key={term}
                className="flex items-center gap-2 bg-elevated/20 rounded-md px-2.5 py-1.5 ring-1 ring-stroke/40"
              >
                <span className="text-xs font-mono text-muted truncate flex-1" title={term}>
                  {term}
                </span>
                <button
                  onClick={() => addIgnoredToDictionary(term)}
                  className="text-[10px] font-mono text-accent hover:text-accent/80 transition-colors cursor-pointer"
                >
                  Add
                </button>
                <button
                  onClick={() => unignore(term)}
                  className="text-[10px] font-mono text-muted hover:text-ink transition-colors cursor-pointer"
                >
                  Forget
                </button>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

function ImportModal({ onClose, onImport }: { onClose: () => void; onImport: (text: string) => Promise<{ added: number; skipped: number } | void> }) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ added: number; skipped: number } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await onImport(text);
      if (res) setResult(res);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const count = text.trim().split(/\r?\n/).filter(Boolean).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-base/60 backdrop-blur-sm p-4">
      <div className="bg-surface border border-stroke rounded-xl p-5 w-full max-w-md shadow-2xl space-y-4 animate-slide-up">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold font-mono text-ink">Import Vocabulary</h3>
          <button onClick={onClose} className="text-muted hover:text-ink text-[18px] leading-none">×</button>
        </div>
        <p className="text-[11px] text-muted leading-relaxed">
          Paste one term per line. Format: <span className="text-ink font-mono">correct_spelling</span> or <span className="text-ink font-mono">correct|misheard1,misheard2</span>
        </p>
        <form onSubmit={handleSubmit} className="space-y-3">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            placeholder="Wisper|whisper, wispr&#10;PostgreSQL|postgres, postgre&#10;Kubernetes|k8s, kube"
            className="w-full bg-elevated/50 rounded-md px-2.5 py-2 text-xs font-mono text-ink placeholder:text-muted/50 outline-none ring-1 ring-stroke focus:ring-accent/40 resize-none transition-all"
          />
          <div className="flex items-center justify-between text-[10px] font-mono text-muted">
            <span>{count} term{count !== 1 ? "s" : ""} ready</span>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-elevated/50 text-muted hover:text-ink hover:bg-elevated rounded-md py-1.5 text-xs font-mono transition-all"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!text.trim() || loading}
              className="flex-1 bg-accent/15 text-accent rounded-md py-1.5 text-xs font-mono hover:bg-accent/25 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              {loading ? "Importing…" : "Import"}
            </button>
          </div>
        </form>
        {result && (
          <div className="text-[10px] font-mono text-ready text-center pt-2 border-t border-stroke/30">
            Imported {result.added} term{result.added !== 1 ? "s" : ""}, skipped {result.skipped}
          </div>
        )}
      </div>
    </div>
  );
}
