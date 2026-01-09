import { useState, useEffect } from "react";

type Provider = "groq" | "openai";

function Settings() {
  const [groqKey, setGroqKey] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [provider, setProvider] = useState<Provider>("groq");
  const [autoCopy, setAutoCopy] = useState(true);
  const [saved, setSaved] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Load stored settings on mount
  useEffect(() => {
    setGroqKey(localStorage.getItem("wisper_groq_key") || "");
    setOpenaiKey(localStorage.getItem("wisper_openai_key") || "");
    setProvider(
      (localStorage.getItem("wisper_provider") as Provider) || "groq",
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
    // Also set the legacy key for backward compatibility
    localStorage.setItem(
      "wisper_api_key",
      provider === "groq" ? groqKey : openaiKey,
    );

    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  // Update legacy key when provider changes
  const handleProviderChange = (newProvider: Provider) => {
    setProvider(newProvider);
    localStorage.setItem(
      "wisper_api_key",
      newProvider === "groq" ? groqKey : openaiKey,
    );
    localStorage.setItem("wisper_provider", newProvider);
  };

  return (
    <div className="min-h-screen bg-dark-400 text-white p-6">
      <div className="max-w-md mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-full bg-linear-to-br from-primary-400 to-primary-600 flex items-center justify-center">
            <svg
              className="w-5 h-5 text-white"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-semibold">Wisper Settings</h1>
            <p className="text-white/50 text-sm">
              Configure your voice dictation
            </p>
          </div>
        </div>

        {/* API Provider */}
        <div className="mb-6">
          <label className="block text-white/70 text-sm font-medium mb-2">
            Transcription Provider
          </label>
          <div className="flex gap-2">
            <button
              onClick={() => handleProviderChange("groq")}
              className={`flex-1 py-3 px-4 rounded-xl text-sm font-medium transition-all ${
                provider === "groq"
                  ? "bg-primary-500 text-white shadow-lg shadow-primary-500/25"
                  : "bg-white/5 text-white/60 hover:bg-white/10"
              }`}
            >
              <div className="flex flex-col items-center gap-1">
                <span>Groq</span>
                <span className="text-xs opacity-60">Free & Fast</span>
              </div>
            </button>
            <button
              onClick={() => handleProviderChange("openai")}
              className={`flex-1 py-3 px-4 rounded-xl text-sm font-medium transition-all ${
                provider === "openai"
                  ? "bg-primary-500 text-white shadow-lg shadow-primary-500/25"
                  : "bg-white/5 text-white/60 hover:bg-white/10"
              }`}
            >
              <div className="flex flex-col items-center gap-1">
                <span>OpenAI</span>
                <span className="text-xs opacity-60">Official API</span>
              </div>
            </button>
          </div>
        </div>

        {/* API Key */}
        <div className="mb-6">
          <label className="block text-white/70 text-sm font-medium mb-2">
            {provider === "groq" ? "Groq" : "OpenAI"} API Key
          </label>
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              value={currentKey}
              onChange={(e) => setCurrentKey(e.target.value)}
              placeholder={provider === "groq" ? "gsk_..." : "sk-..."}
              className="w-full bg-white/5 border border-white/10 rounded-xl pl-4 pr-12 py-3 text-white placeholder-white/30 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70 transition-colors"
            >
              {showPassword ? (
                <svg
                  className="w-5 h-5"
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
                  className="w-5 h-5"
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
          <p className="mt-2 text-white/40 text-xs">
            {provider === "groq" ? (
              <>
                Get your free API key at{" "}
                <a
                  href="https://console.groq.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary-400 hover:underline"
                >
                  console.groq.com
                </a>
              </>
            ) : (
              <>
                Get your API key at{" "}
                <a
                  href="https://platform.openai.com/api-keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary-400 hover:underline"
                >
                  platform.openai.com
                </a>
              </>
            )}
          </p>
        </div>

        {/* Toggles */}
        <div className="space-y-4 mb-8">
          {/* Auto-copy toggle */}
          <div className="flex items-center justify-between p-4 bg-white/5 rounded-xl">
            <div>
              <span className="text-white/90 text-sm font-medium">
                Auto-copy to clipboard
              </span>
              <p className="text-white/40 text-xs mt-0.5">
                Copy transcription to clipboard
              </p>
            </div>
            <button
              onClick={() => setAutoCopy(!autoCopy)}
              className={`w-12 h-6 rounded-full transition-colors relative ${
                autoCopy ? "bg-primary-500" : "bg-white/20"
              }`}
            >
              <span
                className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                  autoCopy ? "left-7" : "left-1"
                }`}
              />
            </button>
          </div>
        </div>

        {/* Hotkey info */}
        <div className="mb-8 p-4 bg-white/5 rounded-xl border border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center">
              <svg
                className="w-4 h-4 text-white/60"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                />
              </svg>
            </div>
            <div>
              <span className="text-white/90 text-sm font-medium">Hotkey</span>
              <p className="text-white/40 text-xs">
                Press{" "}
                <kbd className="px-1.5 py-0.5 bg-white/10 rounded text-white/70">
                  Shift
                </kbd>{" "}
                +{" "}
                <kbd className="px-1.5 py-0.5 bg-white/10 rounded text-white/70">
                  Space
                </kbd>{" "}
                to toggle recording
              </p>
            </div>
          </div>
        </div>

        {/* Save button */}
        <button
          onClick={handleSave}
          className={`w-full py-3 px-4 rounded-xl font-medium transition-all ${
            saved
              ? "bg-green-500 text-white"
              : "bg-linear-to-r from-primary-500 to-primary-600 hover:from-primary-400 hover:to-primary-500 text-white shadow-lg shadow-primary-500/25"
          }`}
        >
          {saved ? "✓ Saved!" : "Save Settings"}
        </button>

        {/* Footer */}
        <p className="mt-6 text-center text-white/30 text-xs">
          Wisper v1.1.0 • Voice dictation for Linux
        </p>
      </div>
    </div>
  );
}

export default Settings;
