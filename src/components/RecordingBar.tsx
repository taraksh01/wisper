import { useState, useEffect, useCallback } from "react";
import { useAudioRecorder } from "../hooks/useAudioRecorder";
import { Waveform } from "./Waveform";

function RecordingBar() {
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { isRecording, audioLevel, startRecording, stopRecording } =
    useAudioRecorder();

  const getApiKey = () => localStorage.getItem("wisper_api_key") || "";

  const transcribeAudio = useCallback(async (audioBlob: Blob) => {
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
        window.electronAPI.hideWindow();
        window.electronAPI.pasteToCursor(trimmedText);
      } else if (window.electronAPI) {
        window.electronAPI.hideWindow();
      }
    } catch (err) {
      console.error("Transcription failed:", err);
      setError(err instanceof Error ? err.message : "Transcription failed");
      setTimeout(() => {
        if (window.electronAPI) {
          window.electronAPI.hideWindow();
        }
      }, 2000);
    } finally {
      setIsTranscribing(false);
    }
  }, []);

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
  }, [stopRecording, transcribeAudio]);

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

  const renderContent = () => {
    if (error) {
      return (
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
          <span className="text-red-300 text-sm font-medium">{error}</span>
        </div>
      );
    }

    if (isTranscribing) {
      return (
        <div className="flex items-center gap-1.5 h-6">
          <span className="w-1.5 bg-primary-500 rounded-full animate-[bounce_0.6s_infinite]" style={{ height: '40%' }} />
          <span className="w-1.5 bg-primary-500 rounded-full animate-[bounce_0.6s_infinite_0.1s]" style={{ height: '80%' }} />
          <span className="w-1.5 bg-primary-500 rounded-full animate-[bounce_0.6s_infinite_0.2s]" style={{ height: '60%' }} />
          <span className="w-1.5 bg-primary-500 rounded-full animate-[bounce_0.6s_infinite_0.3s]" style={{ height: '100%' }} />
          <span className="w-1.5 bg-primary-500 rounded-full animate-[bounce_0.6s_infinite_0.4s]" style={{ height: '50%' }} />
        </div>
      );
    }

    if (isRecording) {
      return <Waveform audioLevel={audioLevel} isRecording={isRecording} />;
    }

    return (
      <div className="flex items-center gap-2 text-white/40">
        <div className="w-6 h-6 rounded-full border-2 border-white/20 flex items-center justify-center">
          <div className="w-2 h-2 rounded-full bg-white/40" />
        </div>
        <span className="text-xs font-medium">Press Shift+Space to record</span>
      </div>
    );
  };

  return (
    <div className="w-full h-full flex items-center justify-center px-4">
      {renderContent()}
    </div>
  );
}

export default RecordingBar;
