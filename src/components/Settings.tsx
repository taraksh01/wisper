import { useState, useEffect } from "react";

type Provider = "groq" | "openai";

function Settings() {
  const [groqKey, setGroqKey] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [provider, setProvider] = useState<Provider>("groq");
  const [saved, setSaved] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    setGroqKey(localStorage.getItem("wisper_groq_key") || "");
    setOpenaiKey(localStorage.getItem("wisper_openai_key") || "");
    setProvider(
      (localStorage.getItem("wisper_provider") as Provider) || "groq",
    );
  }, []);

  const currentKey = provider === "groq" ? groqKey : openaiKey;
  const setCurrentKey = provider === "groq" ? setGroqKey : setOpenaiKey;

  const handleSave = async () => {
    localStorage.setItem("wisper_groq_key", groqKey);
    localStorage.setItem("wisper_openai_key", openaiKey);
    localStorage.setItem("wisper_provider", provider);
    localStorage.setItem(
      "wisper_api_key",
      provider === "groq" ? groqKey : openaiKey,
    );

    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleProviderChange = (newProvider: Provider) => {
    setProvider(newProvider);
    localStorage.setItem(
      "wisper_api_key",
      newProvider === "groq" ? groqKey : openaiKey,
    );
    localStorage.setItem("wisper_provider", newProvider);
  };

  return (
    <div className="min-h-screen bg-dark-400 text-white p-4">
      <div className="max-w-sm mx-auto">
        <div className="flex items-center justify-center gap-3 mb-4">
          <div className="w-8 h-8 rounded-full bg-primary-500 flex items-center justify-center shadow-lg shadow-primary-500/20">
            <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="text-left">
            <h1 className="text-base font-semibold">Wisper</h1>
            <p className="text-white/50 text-xs">Voice dictation for Linux</p>
          </div>
        </div>

        <div className="space-y-3">
          <div className="p-3 bg-white/5 rounded-xl border border-white/5">
            <label className="block text-white/70 text-xs font-medium mb-2">
              Provider
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => handleProviderChange("groq")}
                className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-all ${
                  provider === "groq"
                    ? "bg-primary-500 text-white"
                    : "bg-white/5 text-white/60 hover:bg-white/10"
                }`}
              >
                Groq
              </button>
              <button
                onClick={() => handleProviderChange("openai")}
                className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-all ${
                  provider === "openai"
                    ? "bg-primary-500 text-white"
                    : "bg-white/5 text-white/60 hover:bg-white/10"
                }`}
              >
                OpenAI
              </button>
            </div>
          </div>

          <div className="p-3 bg-white/5 rounded-xl border border-white/5">
            <label className="block text-white/70 text-xs font-medium mb-2">
              API Key
            </label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={currentKey}
                onChange={(e) => setCurrentKey(e.target.value)}
                placeholder={provider === "groq" ? "gsk_..." : "sk-..."}
                className="w-full bg-white/5 border border-white/10 rounded-lg pl-3 pr-10 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-primary-500"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70"
              >
                {showPassword ? (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          <div className="p-3 bg-white/5 rounded-xl border border-white/5">
            <div className="flex items-center gap-2 text-white/60 text-xs">
              <kbd className="px-1.5 py-0.5 bg-white/10 rounded text-white/70">Shift</kbd>
              <span>+</span>
              <kbd className="px-1.5 py-0.5 bg-white/10 rounded text-white/70">Space</kbd>
              <span>to record</span>
            </div>
          </div>
        </div>

        <button
          onClick={handleSave}
          className={`w-full mt-4 py-2.5 px-4 rounded-lg font-medium text-sm transition-all ${
            saved
              ? "bg-green-500 text-white"
              : "bg-primary-500 text-white"
          }`}
        >
          {saved ? "Saved!" : "Save"}
        </button>

        <p className="mt-4 text-center text-white/25 text-xs">v{__APP_VERSION__}</p>
      </div>
    </div>
  );
}

export default Settings;
