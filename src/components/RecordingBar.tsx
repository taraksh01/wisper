import { useState, useEffect, useCallback } from "react";
import { useAudioRecorder } from "../hooks/useAudioRecorder";
import { Waveform } from "./Waveform";

function RecordingBar() {
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { isRecording, audioLevel, startRecording, stopRecording } =
    useAudioRecorder();

  const getApiKey = () => localStorage.getItem("wisper_api_key") || "";

  const transcribeAudio = async (audioBlob: Blob) => {
    const apiKey = getApiKey();
    const provider = localStorage.getItem("wisper_provider") || "groq";

    if (!apiKey) {
      setError("No API key. Open Settings from tray.");
      setTimeout(() => {
        if (window.electronAPI) {
          window.electronAPI.hideWindow();
        }
      }, 2000);
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
          errorData.error?.message || `API error: ${response.status}`,
        );
      }

      const text = await response.text();
      const trimmedText = text.trim();

      if (trimmedText && window.electronAPI) {
        const autoCopyEnabled =
          localStorage.getItem("wisper_auto_copy") !== "false";
        if (autoCopyEnabled) {
          await window.electronAPI.copyToClipboard(trimmedText);
        }
        window.electronAPI.hideWindow();
      } else if (window.electronAPI) {
        window.electronAPI.hideWindow();
      }
    } catch (err) {
      console.error("Transcription failed:", err);
      if (window.electronAPI) {
        window.electronAPI.hideWindow();
      }
    } finally {
      setIsTranscribing(false);
    }
  };

  const handleStartRecording = useCallback(async () => {
    try {
      setError(null);
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

  // Listen for Electron events
  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.onStartRecording(() => {
        handleStartRecording();
      });

      window.electronAPI.onStopRecording(() => {
        handleStopRecording();
      });

      return () => {
        window.electronAPI.removeAllListeners("start-recording");
        window.electronAPI.removeAllListeners("stop-recording");
      };
    }
  }, [handleStartRecording, handleStopRecording]);

  return (
    <div className="w-full h-full flex items-center justify-center px-6">
      {error && <div className="text-red-400 text-sm text-center">{error}</div>}

      {isTranscribing && !error && (
        <div className="flex items-center gap-3">
          <svg
            className="w-5 h-5 text-primary-400 animate-spin"
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
          <span className="text-white/60 text-sm">Transcribing...</span>
        </div>
      )}

      {isRecording && !isTranscribing && !error && (
        <Waveform audioLevel={audioLevel} isRecording={isRecording} />
      )}
    </div>
  );
}

export default RecordingBar;
