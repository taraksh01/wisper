import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AppSettings, WordSuggestion } from "../types";
import { ResetButton } from "./ResetButton";
import { SectionCard } from "./SectionCard";
import { Switch } from "./Switch";
import { WordsManager } from "./WordsManager";
import { useToast } from "./ToastContext";

interface WordsTabProps {
  settings: AppSettings;
  onSave: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  onReset: () => void;
}

export function WordsTab({ settings, onSave, onReset }: WordsTabProps) {
  const toast = useToast();
  const [suggestions, setSuggestions] = useState<WordSuggestion[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState("");

  const onScan = useCallback(async () => {
    setScanning(true);
    setScanMsg("Reading your recent dictations…");
    setSuggestions([]);
    try {
      const s = await invoke<WordSuggestion[]>("suggest_words");
      setSuggestions(s);
      if (s.length === 0) setScanMsg("No new terms found in your recent dictations.");
      else setScanMsg("");
    } catch (e: any) {
      setScanMsg(String(e));
      toast.addToast("Failed to scan vocabulary", "error");
    } finally {
      setScanning(false);
    }
  }, [toast]);

  return (
    <div className="max-w-lg space-y-4 card-enter">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
          </svg>
          <h1 className="text-sm font-semibnold text-ink tracking-tight">Words</h1>
        </div>
        <ResetButton onClick={onReset} />
      </div>

      <SectionCard className="card-enter">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-[10px] font-mono text-muted tracking-[0.12em] uppercase">Custom Words</h2>
            <p className="text-[11px] text-muted mt-1 leading-relaxed">Correct names and terms in every dictation.</p>
          </div>
          <Switch
            checked={settings.words_enabled}
            onChange={(v) => onSave("words_enabled", v)}
          />
        </div>
      </SectionCard>

      {settings.words_enabled && (
        <WordsManager
          suggestions={suggestions}
          scanning={scanning}
          scanMsg={scanMsg}
          onScan={onScan}
          setSuggestions={setSuggestions}
        />
      )}
    </div>
  );
}
