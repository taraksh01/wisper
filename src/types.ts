export interface HistoryEntry {
  id: number;
  raw_text: string;
  formatted_text: string | null;
  agent_name: string | null;
  duration_ms: number;
  word_count: number;
  created_at: string;
  recording_path: string | null;
}

export interface SmartAgent {
  name: string;
  system_prompt: string;
  active: boolean;
}

export interface AppSettings {
  stt_mode: string;
  stt_provider: string;
  stt_base_url: string;
  stt_api_key: string;
  stt_model: string;
  local_model_file: string;
  llm_enabled: boolean;
  llm_base_url: string;
  llm_api_key: string;
  llm_model: string;
  llm_agent_name: string;
  hotkey: string;
  hotkey_mode: string;
  paste_method: string;
  vad_enabled: boolean;
  vad_threshold: number;
  language: string;
  keep_recordings: boolean;
}

export interface ModelInfo {
  name: string;
  size: string;
  accuracy: number;
  speed: number;
  source: string;
  languages: string[];
  format: "ggml" | "gguf" | "onnx";
  quantization: string;
  streaming: boolean;
  translate: boolean;
  runtime: string;
  recommended?: boolean;
}

export const openaiModels = ["whisper-1"];

export const groqModels = [
  "whisper-large-v3",
  "whisper-large-v3-turbo",
  "distil-whisper-large-v3-en",
];

export const modelCatalog: Record<string, ModelInfo> = {
  "parakeet-onnx-tdt-0.6b-v3": {
    name: "Parakeet TDT 0.6B V3 (ONNX)",
    size: "~1.4 GB",
    accuracy: 96,
    speed: 72,
    source: "https://blob.handy.computer/parakeet-v3-int8.tar.gz",
    languages: ["en", "es", "fr", "de", "it", "pt", "nl"],
    format: "onnx",
    quantization: "int8",
    streaming: false,
    translate: false,
    runtime: "onnx",
    recommended: true,
  },
  "parakeet-onnx-tdt-0.6b-v2": {
    name: "Parakeet TDT 0.6B V2 (ONNX)",
    size: "~1.4 GB",
    accuracy: 97,
    speed: 72,
    source: "https://blob.handy.computer/parakeet-v2-int8.tar.gz",
    languages: ["en"],
    format: "onnx",
    quantization: "int8",
    streaming: false,
    translate: false,
    runtime: "onnx",
  },
};

export const allModelKeys = Object.keys(modelCatalog);

export const languages = [
  { value: "auto", label: "Auto-detect" },
  { value: "en", label: "English" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "it", label: "Italian" },
  { value: "pt", label: "Portuguese" },
  { value: "nl", label: "Dutch" },
  { value: "ja", label: "Japanese" },
  { value: "ko", label: "Korean" },
  { value: "zh", label: "Chinese" },
  { value: "ar", label: "Arabic" },
  { value: "hi", label: "Hindi" },
  { value: "ru", label: "Russian" },
];

export const tabs = [
  { id: "general", label: "General" },
  { id: "stt", label: "Engine" },
  { id: "llm", label: "Process" },
  { id: "history", label: "History" },
];

export function formatModelFilename(key: string, _format: "ggml" | "gguf" | "onnx"): string {
  const map: Record<string, string> = {
    "parakeet-onnx-tdt-0.6b-v3": "parakeet-tdt-0.6b-v3-int8",
    "parakeet-onnx-tdt-0.6b-v2": "parakeet-tdt-0.6b-v2-int8",
  };
  return map[key] || key;
}
