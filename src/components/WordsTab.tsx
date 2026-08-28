import { IconWords } from "./ui/icons";
import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AppSettings, WordSuggestion } from "../types";
import { ResetButton } from "./ResetButton";
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
    <div className="w-full space-y-3 card-enter">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <IconWords className="w-5 h-5 text-accent" />
          <h1 className="text-sm font-semibold text-ink tracking-tight">Words</h1>
        </div>
        <ResetButton onClick={onReset} />
      </div>

      <WordsManager
        wordsEnabled={settings.words_enabled}
        onToggle={(v: boolean) => onSave("words_enabled", v)}
        wordsAutoScan={settings.words_auto_scan}
        onToggleAutoScan={(v: boolean) => onSave("words_auto_scan", v)}
        suggestions={suggestions}
        scanning={scanning}
        scanMsg={scanMsg}
        onScan={onScan}
        setSuggestions={setSuggestions}
      />
    </div>
  );
}