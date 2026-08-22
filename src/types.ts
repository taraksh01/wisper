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

export interface AgentProfile {
  id: string;
  name: string;
  description: string;
  system_prompt: string;
}

export interface WordEntry {
  id: number;
  phrase: string;
  variants: string;
  case_sensitive: boolean;
  whole_word: boolean;
  auto: boolean;
  hits: number;
  created_at: string;
}

export interface WordSuggestion {
  phrase: string;
  variants: string[];
  count: number;
}

export interface AppSettings {
  engine_mode: string;
  engine_provider: string;
  engine_base_url: string;
  voice_api_key: string;
  voice_api_key_openai: string;
  voice_api_key_groq: string;
  voice_api_key_custom: string;
  engine_model: string;
  local_model_file: string;
  process_enabled: boolean;
  process_provider: string;
  process_base_url: string;
  process_api_key: string;
  process_api_key_openai: string;
  process_api_key_anthropic: string;
  process_api_key_google: string;
  process_api_key_groq: string;
  process_api_key_together: string;
  process_api_key_deepseek: string;
  process_api_key_kimi: string;
  process_api_key_qwen: string;
  process_api_key_glm: string;
  process_api_key_openrouter: string;
  process_api_key_ollama: string;
  process_api_key_custom: string;
  process_model: string;
  process_max_tokens: number;
  process_agent_profile: string;
  process_agent_name: string;
  process_agent_prompt: string;
  words_enabled: boolean;
  hotkey: string;
  hotkey_mode: string;
  paste_method: string;
  paste_tool: string;
  vad_enabled: boolean;
  vad_threshold: number;
  language: string;
  keep_recordings: boolean;
  launch_to_tray: boolean;
  autostart: boolean;
  overlay_enabled: boolean;
  overlay_position: string;
  input_device: string;
  time_saved_sec: number;
  max_history_entries: number;
  history_retention_mode: string;
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
];

export const modelCatalog: Record<string, ModelInfo> = {
  "parakeet-onnx-tdt-0.6b-v3": {
    name: "Parakeet TDT 0.6B V3 (ONNX)",
    size: "~1.4 GB",
    accuracy: 96,
    speed: 72,
    source: "https://blob.handy.computer/parakeet-v3-int8.tar.gz",
    // Full 25-language set from NVIDIA parakeet-tdt-0.6b-v3 model card
    languages: [
      "en", "es", "fr", "de", "it", "pt", "nl", "ru",
      "bg", "hr", "cs", "da", "et", "fi", "el", "hu",
      "lv", "lt", "mt", "pl", "ro", "sk", "sl", "sv", "uk",
    ],
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
  // ── Indian languages — IndicConformer 120M per-language ONNX (sherpa-onnx) ──
  // 120M params, ~188 MB int8, sherpa-ready (metadata baked in), validated end-to-end. Source: parismitaglobalsolutions/indicconformer-sherpa-onnx
  "indicconformer-120m-hi": {
    name: "IndicConformer Hindi 120M",
    size: "~188 MB",
    accuracy: 93,
    speed: 82,
    source: "https://huggingface.co/parismitaglobalsolutions/indicconformer-sherpa-onnx/resolve/main/hi/model.int8.onnx",
    languages: ["hi"],
    format: "onnx",
    quantization: "int8",
    streaming: false,
    translate: false,
    runtime: "onnx",
  },
  "indicconformer-120m-bn": {
    name: "IndicConformer Bengali 120M",
    size: "~188 MB",
    accuracy: 92,
    speed: 82,
    source: "https://huggingface.co/parismitaglobalsolutions/indicconformer-sherpa-onnx/resolve/main/bn/model.int8.onnx",
    languages: ["bn"],
    format: "onnx",
    quantization: "int8",
    streaming: false,
    translate: false,
    runtime: "onnx",
  },
  "indicconformer-120m-ta": {
    name: "IndicConformer Tamil 120M",
    size: "~188 MB",
    accuracy: 92,
    speed: 82,
    source: "https://huggingface.co/parismitaglobalsolutions/indicconformer-sherpa-onnx/resolve/main/ta/model.int8.onnx",
    languages: ["ta"],
    format: "onnx",
    quantization: "int8",
    streaming: false,
    translate: false,
    runtime: "onnx",
  },
  "indicconformer-120m-te": {
    name: "IndicConformer Telugu 120M",
    size: "~188 MB",
    accuracy: 92,
    speed: 82,
    source: "https://huggingface.co/parismitaglobalsolutions/indicconformer-sherpa-onnx/resolve/main/te/model.int8.onnx",
    languages: ["te"],
    format: "onnx",
    quantization: "int8",
    streaming: false,
    translate: false,
    runtime: "onnx",
  },
  "indicconformer-120m-mr": {
    name: "IndicConformer Marathi 120M",
    size: "~188 MB",
    accuracy: 92,
    speed: 82,
    source: "https://huggingface.co/parismitaglobalsolutions/indicconformer-sherpa-onnx/resolve/main/mr/model.int8.onnx",
    languages: ["mr"],
    format: "onnx",
    quantization: "int8",
    streaming: false,
    translate: false,
    runtime: "onnx",
  },
  "indicconformer-120m-gu": {
    name: "IndicConformer Gujarati 120M",
    size: "~188 MB",
    accuracy: 92,
    speed: 82,
    source: "https://huggingface.co/parismitaglobalsolutions/indicconformer-sherpa-onnx/resolve/main/gu/model.int8.onnx",
    languages: ["gu"],
    format: "onnx",
    quantization: "int8",
    streaming: false,
    translate: false,
    runtime: "onnx",
  },
  "indicconformer-120m-kn": {
    name: "IndicConformer Kannada 120M",
    size: "~188 MB",
    accuracy: 92,
    speed: 82,
    source: "https://huggingface.co/parismitaglobalsolutions/indicconformer-sherpa-onnx/resolve/main/kn/model.int8.onnx",
    languages: ["kn"],
    format: "onnx",
    quantization: "int8",
    streaming: false,
    translate: false,
    runtime: "onnx",
  },
  "indicconformer-120m-ml": {
    name: "IndicConformer Malayalam 120M",
    size: "~188 MB",
    accuracy: 92,
    speed: 82,
    source: "https://huggingface.co/parismitaglobalsolutions/indicconformer-sherpa-onnx/resolve/main/ml/model.int8.onnx",
    languages: ["ml"],
    format: "onnx",
    quantization: "int8",
    streaming: false,
    translate: false,
    runtime: "onnx",
  },
  "indicconformer-120m-pa": {
    name: "IndicConformer Punjabi 120M",
    size: "~188 MB",
    accuracy: 92,
    speed: 82,
    source: "https://huggingface.co/parismitaglobalsolutions/indicconformer-sherpa-onnx/resolve/main/pa/model.int8.onnx",
    languages: ["pa"],
    format: "onnx",
    quantization: "int8",
    streaming: false,
    translate: false,
    runtime: "onnx",
  },
  // Efficient 8-lang multi (188 MB total for 8 Indian langs — best for low disk)
  "indicconformer-8lang": {
    name: "IndicConformer 8-Lang Multi (188 MB for 8 languages)",
    size: "~188 MB",
    accuracy: 90,
    speed: 80,
    source: "https://huggingface.co/meetsync/indic-conformer-onnx-sherpa/resolve/main/model.int8.onnx",
    languages: ["as", "bn", "brx", "gu", "hi", "kn", "ks", "mr"],
    format: "onnx",
    quantization: "int8",
    streaming: false,
    translate: false,
    runtime: "onnx",
  },
  // Moonshine base (English) — merged decoder + tokenizer bundle, transcribe-rs native layout
  "moonshine-base": {
    name: "Moonshine Base (English)",
    size: "~56 MB",
    accuracy: 90,
    speed: 95,
    source: "https://blob.handy.computer/moonshine-base.tar.gz",
    languages: ["en"],
    format: "onnx",
    quantization: "fp32",
    streaming: false,
    translate: false,
    runtime: "onnx",
  },
};

export const allModelKeys = Object.keys(modelCatalog);

// All supported languages, sorted alphabetically by label (auto pinned first by consumers)
const RAW_LANGUAGES = [
  { value: "ar", label: "Arabic" },
  { value: "as", label: "Assamese" },
  { value: "bn", label: "Bengali" },
  { value: "brx", label: "Bodo" },
  { value: "bg", label: "Bulgarian" },
  { value: "zh", label: "Chinese" },
  { value: "hr", label: "Croatian" },
  { value: "cs", label: "Czech" },
  { value: "da", label: "Danish" },
  { value: "nl", label: "Dutch" },
  { value: "en", label: "English" },
  { value: "et", label: "Estonian" },
  { value: "fi", label: "Finnish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "el", label: "Greek" },
  { value: "gu", label: "Gujarati" },
  { value: "hi", label: "Hindi" },
  { value: "hu", label: "Hungarian" },
  { value: "it", label: "Italian" },
  { value: "ja", label: "Japanese" },
  { value: "ks", label: "Kashmiri" },
  { value: "kn", label: "Kannada" },
  { value: "ko", label: "Korean" },
  { value: "lv", label: "Latvian" },
  { value: "lt", label: "Lithuanian" },
  { value: "ml", label: "Malayalam" },
  { value: "mt", label: "Maltese" },
  { value: "mr", label: "Marathi" },
  { value: "pl", label: "Polish" },
  { value: "pt", label: "Portuguese" },
  { value: "pa", label: "Punjabi" },
  { value: "ro", label: "Romanian" },
  { value: "ru", label: "Russian" },
  { value: "sk", label: "Slovak" },
  { value: "sl", label: "Slovenian" },
  { value: "es", label: "Spanish" },
  { value: "sv", label: "Swedish" },
  { value: "ta", label: "Tamil" },
  { value: "te", label: "Telugu" },
  { value: "uk", label: "Ukrainian" },
];

export const languages = [
  { value: "auto", label: "Auto-detect" },
  ...RAW_LANGUAGES,
];

export const tabs = [
  { id: "general", label: "General" },
  { id: "engine", label: "Engine" },
  { id: "process", label: "Process" },
  { id: "words", label: "Words" },
  { id: "history", label: "History" },
  { id: "about", label: "About" },
  { id: "donate", label: "Donate" },
];

export function formatModelFilename(key: string, _format: "ggml" | "gguf" | "onnx"): string {
  const map: Record<string, string> = {
    "parakeet-onnx-tdt-0.6b-v3": "parakeet-tdt-0.6b-v3-int8",
    "parakeet-onnx-tdt-0.6b-v2": "parakeet-tdt-0.6b-v2-int8",
  };
  return map[key] || key;
}

export interface ProcessProvider {
  name: string;
  label: string;
  base_url: string;
  models: string[];
}

export const PROCESS_PROVIDERS: ProcessProvider[] = [
  {
    name: "openai",
    label: "OpenAI",
    base_url: "https://api.openai.com/v1",
    models: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-nano"],
  },
  {
    name: "anthropic",
    label: "Anthropic",
    base_url: "https://api.anthropic.com/v1",
    models: ["claude-haiku-3-5-20241022", "claude-sonnet-4-20250514"],
  },
  {
    name: "google",
    label: "Google Gemini",
    base_url: "https://generativelanguage.googleapis.com/v1beta/openai",
    models: ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-2.5-pro"],
  },
  {
    name: "groq",
    label: "Groq",
    base_url: "https://api.groq.com/openai/v1",
    models: ["llama-3.1-8b-instant", "llama-3.3-70b-versatile"],
  },
  {
    name: "together",
    label: "Together AI",
    base_url: "https://api.together.xyz/v1",
    models: ["meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo", "meta-llama/Llama-3.3-70B-Instruct-Turbo"],
  },
  {
    name: "deepseek",
    label: "DeepSeek",
    base_url: "https://api.deepseek.com/v1",
    models: ["deepseek-v4-flash", "deepseek-v4-pro"],
  },
  {
    name: "kimi",
    label: "Kimi (Moonshot)",
    base_url: "https://api.moonshot.ai/v1",
    models: ["kimi-k2.6", "kimi-k2.5"],
  },
  {
    name: "qwen",
    label: "Qwen (Alibaba)",
    base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    models: ["qwen3.6-flash", "qwen3.6-plus", "qwen3.7-max"],
  },
  {
    name: "glm",
    label: "GLM (Zhipu AI)",
    base_url: "https://api.z.ai/api/v1",
    models: ["glm-4.7-flashx", "glm-5.1", "glm-5.2"],
  },
  {
    name: "openrouter",
    label: "OpenRouter",
    base_url: "https://openrouter.ai/api/v1",
    models: [
      "openrouter/auto",
      "meta-llama/llama-3.2-3b-instruct:free",
      "google/gemini-2.0-flash-exp:free",
      "openai/gpt-4o-mini",
      "anthropic/claude-3.5-haiku",
      "deepseek/deepseek-v4-flash:free",
    ],
  },
  {
    name: "ollama",
    label: "Ollama (Local)",
    base_url: "http://localhost:11434/v1",
    models: ["llama3.2", "mistral", "phi4", "qwen2.5"],
  },
  {
    name: "custom",
    label: "Custom",
    base_url: "",
    models: [],
  },
];
