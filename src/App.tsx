import { useState, useEffect, useCallback } from "react";
import { useAudioRecorder } from "./hooks/useAudioRecorder";
import { Waveform } from "./components/Waveform";
import { Transcript } from "./components/Transcript";
import Settings from "./components/Settings";

function App() {
  const [transcription, setTranscription] = useState("");
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { isRecording, audioLevel, startRecording, stopRecording } =
    useAudioRecorder();

  const getApiKey = () => localStorage.getItem("wisper_api_key") || "";

  const transcribeAudio = async (audioBlob: Blob) => {
    const apiKey = getApiKey();
    const provider = localStorage.getItem("wisper_provider") || "groq";

    if (!apiKey) {
      setError("Please set your API key in settings");
      setShowSettings(true);
      return;
    }

    setIsTranscribing(true);

    try {
      const formData = new FormData();
      const extension = audioBlob.type.includes("ogg") ? "ogg" : "webm";
      formData.append("file", audioBlob, `recording.${extension}`);
      formData.append("response_format", "text");

      let apiUrl: string;
      let model: string;

      if (provider === "groq") {
        apiUrl = "https://api.groq.com/openai/v1/audio/transcriptions";
        model = "whisper-large-v3-turbo";
      } else {
        apiUrl = "https://api.openai.com/v1/audio/transcriptions";
        model = "whisper-1";
      }

      formData.append("model", model);

      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.error?.message || `API error: ${response.status}`
        );
      }

      const text = await response.text();
      const trimmedText = text.trim();
      setTranscription(trimmedText);

      // Auto-copy to clipboard if enabled
      const autoCopyEnabled =
        localStorage.getItem("wisper_auto_copy") !== "false";
      if (autoCopyEnabled && trimmedText && window.electronAPI) {
        await window.electronAPI.copyToClipboard(trimmedText);
      }
    } catch (err) {
      console.error("Transcription failed:", err);
      setError(err instanceof Error ? err.message : "Transcription failed");
    } finally {
      setIsTranscribing(false);
    }
  };

  const handleStartRecording = useCallback(async () => {
    try {
      setError(null);
      setTranscription("");
      await startRecording();
      if (window.electronAPI) {
        window.electronAPI.setRecordingState(true);
      }
    } catch (err) {
      setError("Failed to access microphone");
    }
  }, [startRecording]);

  const handleStopRecording = useCallback(async () => {
    const audioBlob = await stopRecording();
    if (window.electronAPI) {
      window.electronAPI.setRecordingState(false);
    }
    if (audioBlob) {
      await transcribeAudio(audioBlob);
    }
  }, [stopRecording]);

  const toggleRecording = useCallback(() => {
    if (isRecording) {
      handleStopRecording();
    } else {
      handleStartRecording();
    }
  }, [isRecording, handleStartRecording, handleStopRecording]);

  // Listen for Electron events
  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.onStartRecording(() => {
        handleStartRecording();
      });

      window.electronAPI.onStopRecording(() => {
        handleStopRecording();
      });

      window.electronAPI.onOpenSettings(() => {
        setShowSettings(true);
      });

      return () => {
        window.electronAPI.removeAllListeners("start-recording");
        window.electronAPI.removeAllListeners("stop-recording");
        window.electronAPI.removeAllListeners("open-settings");
      };
    }
  }, [handleStartRecording, handleStopRecording]);

  return (
    <div className="glass rounded-2xl p-4 w-full h-full flex flex-col box-border overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center justify-between mb-3"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center">
            <svg
              className="w-4 h-4 text-white"
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
          <span className="text-white font-semibold text-sm">Wisper</span>
        </div>
        <div className="flex items-center gap-1">
          {/* Copy button - show when auto-copy off and transcription exists */}
          {transcription &&
            !isRecording &&
            !isTranscribing &&
            localStorage.getItem("wisper_auto_copy") === "false" && (
              <button
                data-no-drag
                onClick={async () => {
                  if (window.electronAPI) {
                    await window.electronAPI.copyToClipboard(transcription);
                  }
                }}
                className="w-7 h-7 rounded-full hover:bg-white/10 flex items-center justify-center transition-colors"
                title="Copy to clipboard"
              >
                <svg
                  className="w-3.5 h-3.5 text-white/60"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                  />
                </svg>
              </button>
            )}
          <button
            data-no-drag
            onClick={() => setShowSettings(!showSettings)}
            className="w-7 h-7 rounded-full hover:bg-white/10 flex items-center justify-center transition-colors"
          >
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
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Main content */}
      {showSettings ? (
        <Settings onClose={() => setShowSettings(false)} />
      ) : (
        <div
          className="flex-1 flex flex-col cursor-pointer"
          onClick={toggleRecording}
          data-no-drag
        >
          {/* Transcribing state */}
          {isTranscribing ? (
            <div className="flex flex-col items-center justify-center py-8">
              <div className="w-14 h-14 rounded-full bg-primary-500/20 flex items-center justify-center">
                <svg
                  className="w-7 h-7 text-primary-400 animate-spin"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
              </div>
              <p className="mt-3 text-white/60 text-sm">Transcribing...</p>
            </div>
          ) : (
            <Waveform audioLevel={audioLevel} isRecording={isRecording} />
          )}

          {/* Error message */}
          {error && (
            <div className="mt-2 p-2 bg-red-500/20 rounded-lg text-red-400 text-xs text-center">
              {error}
            </div>
          )}

          {/* Transcript */}
          {transcription && !isRecording && !isTranscribing && (
            <Transcript text={transcription} />
          )}

          {/* Hint */}
          {!isRecording && !isTranscribing && !transcription && (
            <p className="text-center text-white/40 text-xs mt-2">
              Click to start recording
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default App;
