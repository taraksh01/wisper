import { useState, useEffect, useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { WordEntry, WordSuggestion } from "../types";
import { SectionCard } from "./SectionCard";
import { Switch } from "./Switch";
import { Input } from "./ui/Input";
import { Textarea } from "./ui/Textarea";
import { useToast } from "./ToastContext";

interface WordsManagerProps {
  wordsEnabled: boolean;
  onToggle: (v: boolean) => void;
  wordsAutoScan: boolean;
  onToggleAutoScan: (v: boolean) => void;
  suggestions: WordSuggestion[];
  scanning: boolean;
  scanMsg: string;
  onScan: () => void;
  setSuggestions: Dispatch<SetStateAction<WordSuggestion[]>>;
}

export function WordsManager({ wordsEnabled, onToggle, wordsAutoScan, onToggleAutoScan, suggestions, scanning, scanMsg, onScan, setSuggestions }: WordsManagerProps) {
  const { addToast } = useToast();
  const [entries, setEntries] = useState<WordEntry[]>([]);
  const [phrase, setPhrase] = useState("");
  const [variants, setVariants] = useState("");
  const [error, setError] = useState("");
  const [ignored, setIgnored] = useState<string[]>([]);
  const [showImport, setShowImport] = useState(false);
  const [dictQuery, setDictQuery] = useState("");

  const loadIgnored = useCallback(async () => {
    try {
      const list = await invoke<string[]>("get_ignored_terms");
      setIgnored(list);
    } catch (e) {
      console.error(e);
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const v = await invoke<WordEntry[]>("get_words");
      setEntries(v);
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
      await invoke("add_word_entry", {
        phrase: phrase.trim(),
        variants: variants.trim(),
        caseSensitive: false,
        wholeWord: true,
        auto: false,
      });
      setPhrase("");
      setVariants("");
      await load();
      addToast("Term added", "success");
    } catch (e: any) {
      setError(String(e));
      addToast("Failed to add term", "error");
    }
  }

  async function removeEntry(id: number) {
    try {
      await invoke("delete_word_entry", { id });
      await load();
      addToast("Term deleted", "success");
    } catch (e) {
      console.error(e);
      addToast("Failed to delete term", "error");
    }
  }

  async function acceptSuggestion(s: WordSuggestion) {
    try {
      await invoke("add_word_entry", {
        phrase: s.phrase,
        variants: s.variants.join(", "),
        caseSensitive: false,
        wholeWord: true,
        auto: false,
      });
      setSuggestions((prev) => prev.filter((x) => x.phrase !== s.phrase));
      await load();
      addToast("Term added", "success");
    } catch (e) {
      console.error(e);
      addToast("Failed to add term", "error");
    }
  }

  function updateSuggestion(index: number, patch: Partial<WordSuggestion>) {
    setSuggestions((prev) => prev.map((x, i) => (i === index ? { ...x, ...patch } : x)));
  }

  async function dismissSuggestion(s: WordSuggestion) {
    try {
      await invoke("ignore_word_suggestion", { term: s.phrase });
      addToast("Suggestion dismissed", "info");
    } catch (e) {
      console.error(e);
      addToast("Failed to dismiss suggestion", "error");
    }
    setSuggestions((prev) => prev.filter((x) => x.phrase !== s.phrase));
    loadIgnored();
  }

  async function addIgnoredToDictionary(term: string) {
    try {
      await invoke("add_ignored_to_dictionary", { term });
      await loadIgnored();
      await load();
      addToast("Added to dictionary", "success");
    } catch (e) {
      console.error(e);
      addToast("Failed to add to dictionary", "error");
    }
  }

  async function unignore(term: string) {
    try {
      await invoke("unignore_word_term", { term });
      await loadIgnored();
      addToast("Term restored", "success");
    } catch (e) {
      console.error(e);
      addToast("Failed to restore term", "error");
    }
  }

  const handleImport = async (paste: string) => {
    const lines = paste.trim().split(/\r?\n/).filter(Boolean);
    let added = 0, skipped = 0;
    for (const line of lines) {
      try {
        const [phrase, variants] = line.split("|").map(s => s.trim());
        if (!phrase) continue;
        await invoke("add_word_entry", {
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

  const filteredEntries = dictQuery.trim()
    ? entries.filter((e) => {
        const q = dictQuery.toLowerCase();
        return e.phrase.toLowerCase().includes(q) || e.variants.toLowerCase().includes(q);
      })
    : entries;

  return (
    <div className="space-y-3">
      <SectionCard className="card-enter">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="label-soft">Your Dictionary</h2>
            <p className="text-[11px] text-muted mt-1 leading-relaxed">Make sure names and jargon are always spelled your way.</p>
          </div>
          <Switch label="Your dictionary" checked={wordsEnabled} onChange={onToggle} />
        </div>
        {wordsEnabled && (
          <div className="flex items-center justify-between gap-3 pt-3 mt-3 border-t border-stroke/30">
            <div>
              <h3 className="text-xs font-medium text-ink">Auto-scan</h3>
              <p className="text-[10px] font-mono text-muted mt-0.5">Suggest corrections automatically after each dictation.</p>
            </div>
            <Switch label="Auto-scan" checked={wordsAutoScan} onChange={onToggleAutoScan} />
          </div>
        )}
      </SectionCard>

      {!wordsEnabled ? (
        <p className="text-[11px] text-muted/60 text-center py-6">Enable your dictionary to manage custom spellings.</p>
      ) : (
        <SectionCard className="card-enter space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="label-soft">Scan history</h2>
              <p className="text-[11px] text-muted mt-1 leading-relaxed">Find recurring names and terms to add.</p>
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

          {scanMsg && <p className="text-[10px] font-mono text-muted">{scanMsg}</p>}

            {suggestions.length > 0 && (
              <>
                <p className="text-[10px] font-mono text-muted/70 leading-relaxed">
                  Edit the <span className="text-ink">correct spelling</span> on the left; add how it was <span className="text-ink">misheard</span> on the right.
                </p>
                <div className="space-y-1.5 max-h-48 overflow-y-auto custom-scrollbar pr-0.5">
                  {suggestions.map((s, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 bg-elevated/30 rounded-lg px-2.5 py-2 ring-1 ring-stroke/60"
                    >
                      <Input
                        variant="ghost"
                        value={s.phrase}
                        onChange={(e) => updateSuggestion(i, { phrase: e.target.value })}
                        placeholder="Correct spelling"
                        title="Correct spelling to use"
                        className="w-28 shrink-0"
                      />
                      <span className="text-[10px] font-mono text-muted/60 shrink-0" title="will be replaced by the correct spelling">←</span>
                      <Input
                        variant="ghost"
                        value={s.variants.join(", ")}
                        onChange={(e) =>
                          updateSuggestion(i, {
                            variants: e.target.value.split(",").map((v) => v.trim()).filter(Boolean),
                          })
                        }
                        placeholder="misheard, forms"
                        title="Comma-separated misheard forms"
                        className="flex-1 min-w-0 text-[10px] text-muted placeholder:text-muted/40"
                      />
                      <div className="ml-auto flex items-center gap-2 shrink-0">
                        <span className="text-[9px] font-mono text-muted/70" title={`Seen ${s.count} times in your recent dictations`}>seen {s.count}×</span>
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
              </>
            )}

          <div className="pt-4 border-t border-stroke/30 space-y-3">
            <div>
              <h2 className="label-soft">Dictionary</h2>
              <p className="text-[11px] text-muted leading-relaxed mt-1">
                Teach Wisper the right spelling — e.g. <span className="text-ink font-mono">whisper</span> →{" "}
                <span className="text-ink font-mono">Wisper</span>.
              </p>
            </div>

            <div className="space-y-1.5">
              <Input
                value={phrase}
                onChange={(e) => setPhrase(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addEntry()}
                placeholder="The correct spelling (e.g. Wisper)"
                className="w-full"
              />
              <Input
                value={variants}
                onChange={(e) => setVariants(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addEntry()}
                placeholder="Ways it might be misheard, separated by commas (e.g. whisper, wispr)"
                className="w-full"
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={addEntry}
                  disabled={!phrase.trim()}
                  className="bg-accent/15 text-accent rounded-lg px-3 py-1.5 text-xs font-mono hover:bg-accent/25 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer"
                >
                  Add term
                </button>
                {error && <span className="text-[10px] font-mono text-red-400">{error}</span>}
              </div>
            </div>

            <div>
              <button
                onClick={() => setShowImport(true)}
                className="w-full bg-elevated/30 text-muted hover:text-ink hover:bg-elevated/50 rounded-lg px-3 py-1.5 text-xs font-mono transition-all cursor-pointer"
              >
                Import multiple terms…
              </button>
            </div>

            {showImport && (
              <ImportModal onClose={() => setShowImport(false)} onImport={handleImport} />
            )}

            {entries.length > 0 && (
              <div className="space-y-2">
                <div className="relative">
                  <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted/50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}><circle cx="11" cy="11" r="6" /><path d="m15 15 3 3" strokeLinecap="round" /></svg>
                  <Input
                    value={dictQuery}
                    onChange={(e) => setDictQuery(e.target.value)}
                    placeholder="Search dictionary…"
                    className="w-full pl-8 pr-3"
                  />
                </div>
                <div className="space-y-1 max-h-64 overflow-y-auto custom-scrollbar pr-0.5">
                  {filteredEntries.length === 0 ? (
                    <p className="text-[11px] text-muted/60 text-center py-4">No matches for “{dictQuery}”</p>
                  ) : (
                    filteredEntries.map((e) => (
                      <div
                        key={e.id}
                        className="flex items-center gap-2 bg-elevated/30 rounded-lg px-2.5 py-2 ring-1 ring-stroke/60"
                      >
                        <span className="text-xs font-mono text-ink shrink-0">{e.phrase}</span>
                        {e.variants && (
                          <span className="text-[10px] font-mono text-muted truncate" title={e.variants}>
                            ← {e.variants}
                          </span>
                        )}
                        <div className="ml-auto flex items-center gap-2 shrink-0">
                          {e.auto && (
                            <span className="text-[9px] font-mono bg-accent/10 text-accent/80 px-1.5 py-0.5 rounded">auto</span>
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
                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                              <path d="M18 6L6 18M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {ignored.length > 0 && (
              <div className="space-y-1 pt-2 border-t border-stroke/30">
                <p className="text-[9px] font-mono text-muted tracking-[0.12em] uppercase">Ignored</p>
                {ignored.map((term) => (
                  <div
                    key={term}
                    className="flex items-center gap-2 bg-elevated/20 rounded-lg px-2.5 py-1.5 ring-1 ring-stroke/40"
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
            </div>
          </SectionCard>
      )}
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

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-base/60 backdrop-blur-sm p-4">
      <div className="bg-surface border border-stroke rounded-xl p-5 w-full max-w-md shadow-2xl space-y-4 animate-slide-up">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold font-mono text-ink">Import Words</h3>
          <button onClick={onClose} className="text-muted hover:text-ink text-[18px] leading-none">×</button>
        </div>
        <p className="text-[11px] text-muted leading-relaxed">
          Paste one term per line. Format: <span className="text-ink font-mono">correct_spelling</span> or <span className="text-ink font-mono">correct|misheard1,misheard2</span>
        </p>
        <form onSubmit={handleSubmit} className="space-y-3">
          <Textarea
            value={text}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setText(e.target.value)}
            rows={8}
            placeholder="Wisper|whisper, wispr&#10;PostgreSQL|postgres, postgre&#10;Kubernetes|k8s, kube"
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
    </div>,
    document.body
  );
}
