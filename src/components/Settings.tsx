import { useState, useEffect } from "react";

interface SettingsProps {
  onClose: () => void;
}

type Provider = "groq" | "openai";

export default function Settings({ onClose }: SettingsProps) {
  const [groqKey, setGroqKey] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [provider, setProvider] = useState<Provider>("groq");
  const [autoCopy, setAutoCopy] = useState(true);
  const [saved, setSaved] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Load stored keys on mount
  useEffect(() => {
    setGroqKey(localStorage.getItem("wisper_groq_key") || "");
    setOpenaiKey(localStorage.getItem("wisper_openai_key") || "");
    setProvider(
      (localStorage.getItem("wisper_provider") as Provider) || "groq"
    );
    setAutoCopy(localStorage.getItem("wisper_auto_copy") !== "false");
  }, []);

  // Get current key based on provider
  const currentKey = provider === "groq" ? groqKey : openaiKey;
  const setCurrentKey = provider === "groq" ? setGroqKey : setOpenaiKey;

  const handleSave = async () => {
    localStorage.setItem("wisper_groq_key", groqKey);
    localStorage.setItem("wisper_openai_key", openaiKey);
    localStorage.setItem("wisper_provider", provider);
    localStorage.setItem("wisper_auto_copy", autoCopy.toString());
    // Also set the legacy key for backward compatibility with App.tsx
    localStorage.setItem(
      "wisper_api_key",
      provider === "groq" ? groqKey : openaiKey
    );

    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  // Update legacy key when provider changes
  const handleProviderChange = (newProvider: Provider) => {
    setProvider(newProvider);
    // Update legacy key immediately for App.tsx
    localStorage.setItem(
      "wisper_api_key",
      newProvider === "groq" ? groqKey : openaiKey
    );
    localStorage.setItem("wisper_provider", newProvider);
  };

  return (
    <div className="flex flex-col h-full" data-no-drag>
      <h3 className="text-white/90 font-medium text-sm mb-2">Settings</h3>

      {/* API Provider Toggle */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-white/60 text-xs">Provider</span>
        <div className="flex gap-1 text-xs">
          <button
            onClick={() => handleProviderChange("groq")}
            className={`px-2 py-1 rounded ${
              provider === "groq"
                ? "bg-primary-500 text-white"
                : "bg-white/10 text-white/60"
            }`}
          >
            Groq
          </button>
          <button
            onClick={() => handleProviderChange("openai")}
            className={`px-2 py-1 rounded ${
              provider === "openai"
                ? "bg-primary-500 text-white"
                : "bg-white/10 text-white/60"
            }`}
          >
            OpenAI
          </button>
        </div>
      </div>

      {/* API Key - separate storage per provider */}
      <div className="mb-2">
        <label className="block text-white/60 text-xs mb-1">
          {provider === "groq" ? "Groq" : "OpenAI"} API Key
        </label>
        <div className="relative">
          <input
            type={showPassword ? "text" : "password"}
            value={currentKey}
            onChange={(e) => setCurrentKey(e.target.value)}
            placeholder={provider === "groq" ? "gsk_..." : "sk-..."}
            className="w-full bg-white/5 border border-white/10 rounded-lg pl-3 pr-8 py-1.5 text-white text-xs placeholder-white/30 focus:outline-none focus:border-primary-500"
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70 transition-colors"
          >
            {showPassword ? (
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
                />
              </svg>
            ) : (
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Auto-copy toggle */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-white/60 text-xs">Auto-copy to clipboard</span>
        <button
          onClick={() => setAutoCopy(!autoCopy)}
          className={`w-10 h-5 rounded-full transition-colors relative ${
            autoCopy ? "bg-primary-500" : "bg-white/20"
          }`}
        >
          <span
            className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
              autoCopy ? "left-5" : "left-0.5"
            }`}
          />
        </button>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2 mt-auto pt-2">
        <button
          onClick={handleSave}
          className="flex-1 py-2 px-3 bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-400 hover:to-primary-500 text-white text-xs font-medium rounded-lg"
        >
          {saved ? "✓ Saved!" : "Save"}
        </button>
        <button
          onClick={onClose}
          className="py-2 px-3 bg-white/10 hover:bg-white/20 text-white/80 text-xs font-medium rounded-lg"
        >
          Close
        </button>
      </div>
    </div>
  );
}
