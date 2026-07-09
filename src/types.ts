export interface HistoryEntry {
  id: number;
  raw_text: string;
  formatted_text: string | null;
  agent_name: string | null;
  duration_ms: number;
  word_count: number;
  created_at: string;
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
}

export interface ModelInfo {
  name: string;
  size: string;
  accuracy: number;
  speed: number;
  source: string;
  languages: string[];
  format: "ggml" | "gguf";
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
  "tiny.en": {
    name: "Tiny English",
    size: "~75 MB",
    accuracy: 94,
    speed: 95,
    source: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin",
    languages: ["en"],
    format: "ggml",
    quantization: "f32",
    streaming: false,
    translate: false,
    runtime: "whisper.cpp",
  },
  "base.en": {
    name: "Base English",
    size: "~142 MB",
    accuracy: 96,
    speed: 85,
    source: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin",
    languages: ["en"],
    format: "ggml",
    quantization: "f32",
    streaming: false,
    translate: false,
    runtime: "whisper.cpp",
  },
  "small.en": {
    name: "Small English",
    size: "~466 MB",
    accuracy: 97,
    speed: 65,
    source: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin",
    languages: ["en"],
    format: "ggml",
    quantization: "f32",
    streaming: false,
    translate: false,
    runtime: "whisper.cpp",
  },
  "tiny": {
    name: "Tiny Multilingual",
    size: "~75 MB",
    accuracy: 93,
    speed: 95,
    source: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin",
    languages: ["en", "es", "fr", "de", "it", "pt", "nl", "ja", "ko", "zh", "ar", "hi", "ru"],
    format: "ggml",
    quantization: "f32",
    streaming: false,
    translate: false,
    runtime: "whisper.cpp",
  },
  "base": {
    name: "Base Multilingual",
    size: "~142 MB",
    accuracy: 95,
    speed: 85,
    source: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
    languages: ["en", "es", "fr", "de", "it", "pt", "nl", "ja", "ko", "zh", "ar", "hi", "ru"],
    format: "ggml",
    quantization: "f32",
    streaming: false,
    translate: false,
    runtime: "whisper.cpp",
  },
  "small": {
    name: "Small Multilingual",
    size: "~466 MB",
    accuracy: 95,
    speed: 55,
    source: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin",
    languages: ["en", "es", "fr", "de", "it", "pt", "nl", "ja", "ko", "zh", "ar", "hi", "ru"],
    format: "ggml",
    quantization: "f32",
    streaming: false,
    translate: false,
    runtime: "whisper.cpp",
  },
  "medium": {
    name: "Medium Multilingual",
    size: "~1.5 GB",
    accuracy: 96,
    speed: 40,
    source: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin",
    languages: ["en", "es", "fr", "de", "it", "pt", "nl", "ja", "ko", "zh", "ar", "hi", "ru"],
    format: "ggml",
    quantization: "f32",
    streaming: false,
    translate: false,
    runtime: "whisper.cpp",
  },
  "large-v3": {
    name: "Large V3 Multilingual",
    size: "~2.9 GB",
    accuracy: 98,
    speed: 10,
    source: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin",
    languages: ["en", "es", "fr", "de", "it", "pt", "nl", "ja", "ko", "zh", "ar", "hi", "ru"],
    format: "ggml",
    quantization: "f32",
    streaming: false,
    translate: false,
    runtime: "whisper.cpp",
  },
  "large-v3-turbo": {
    name: "Large V3 Turbo",
    size: "~1.6 GB",
    accuracy: 96,
    speed: 70,
    source: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin",
    languages: ["en", "es", "fr", "de", "it", "pt", "nl", "ja", "ko", "zh", "ar", "hi", "ru"],
    format: "ggml",
    quantization: "f32",
    streaming: false,
    translate: false,
    runtime: "whisper.cpp",
  },
  "parakeet-tdt_ctc-110m": {
    name: "Parakeet TDT+CTC 110M",
    size: "~480 MB",
    accuracy: 92,
    speed: 98,
    source: "https://huggingface.co/mudler/parakeet-cpp-gguf/resolve/main/parakeet-tdt_ctc-110m-f16.gguf",
    languages: ["en"],
    format: "gguf",
    quantization: "f16",
    streaming: false,
    translate: false,
    runtime: "parakeet.cpp",
  },
  "parakeet-tdt-0.6b-v2": {
    name: "Parakeet TDT 0.6B V2",
    size: "~1.4 GB",
    accuracy: 97,
    speed: 72,
    source: "https://huggingface.co/mudler/parakeet-cpp-gguf/resolve/main/tdt-0.6b-v2-f16.gguf",
    languages: ["en"],
    format: "gguf",
    quantization: "f16",
    streaming: true,
    translate: false,
    runtime: "parakeet.cpp",
    recommended: true,
  },
  "parakeet-tdt-0.6b-v3": {
    name: "Parakeet TDT 0.6B V3",
    size: "~1.4 GB",
    accuracy: 96,
    speed: 72,
    source: "https://huggingface.co/mudler/parakeet-cpp-gguf/resolve/main/tdt-0.6b-v3-f16.gguf",
    languages: ["en", "es", "fr", "de", "it", "pt", "nl"],
    format: "gguf",
    quantization: "f16",
    streaming: true,
    translate: false,
    runtime: "parakeet.cpp",
    recommended: true,
  },
  "parakeet-ctc-0.6b": {
    name: "Parakeet CTC 0.6B",
    size: "~1.3 GB",
    accuracy: 93,
    speed: 75,
    source: "https://huggingface.co/mudler/parakeet-cpp-gguf/resolve/main/parakeet-ctc-0.6b-f16.gguf",
    languages: ["en"],
    format: "gguf",
    quantization: "f16",
    streaming: false,
    translate: false,
    runtime: "parakeet.cpp",
  },
  "parakeet-tdt-1.1b": {
    name: "Parakeet TDT 1.1B",
    size: "~2.3 GB",
    accuracy: 98,
    speed: 40,
    source: "https://huggingface.co/mudler/parakeet-cpp-gguf/resolve/main/parakeet-tdt-1.1b-f16.gguf",
    languages: ["en"],
    format: "gguf",
    quantization: "f16",
    streaming: true,
    translate: false,
    runtime: "parakeet.cpp",
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

export function formatModelFilename(key: string, format: "ggml" | "gguf"): string {
  return format === "ggml" ? `ggml-${key}.bin` : `${key}.gguf`;
}
