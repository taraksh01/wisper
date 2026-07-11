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
  voice_api_key: string;
  voice_api_key_openai: string;
  voice_api_key_groq: string;
  voice_api_key_custom: string;
  stt_model: string;
  local_model_file: string;
  llm_enabled: boolean;
  llm_provider: string;
  llm_base_url: string;
  llm_api_key: string;
  llm_api_key_openai: string;
  llm_api_key_anthropic: string;
  llm_api_key_google: string;
  llm_api_key_groq: string;
  llm_api_key_together: string;
  llm_api_key_deepseek: string;
  llm_api_key_kimi: string;
  llm_api_key_qwen: string;
  llm_api_key_glm: string;
  llm_api_key_openrouter: string;
  llm_api_key_ollama: string;
  llm_api_key_custom: string;
  llm_model: string;
  llm_agent_name: string;
  llm_agent_prompt: string;
  hotkey: string;
  hotkey_mode: string;
  paste_method: string;
  paste_tool: string;
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

export interface LlmProvider {
  name: string;
  label: string;
  base_url: string;
  models: string[];
}

export const LLM_PROVIDERS: LlmProvider[] = [
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
