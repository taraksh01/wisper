import { useState, useEffect, useCallback, useRef } from "react";
import RecordingIndicator from "./components/RecordingIndicator";
import TranscriptionDisplay from "./components/TranscriptionDisplay";
import Settings from "./components/Settings";

function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [transcription, setTranscription] = useState("");
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number>(0);

  // Get API key from localStorage
  const getApiKey = () => localStorage.getItem("wisper_api_key") || "";

  // Start recording
  const startRecording = useCallback(async () => {
    try {
      setError(null);
      setTranscription("");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Set up audio analyser for waveform
      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      // Start monitoring audio level
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const updateLevel = () => {
        if (analyserRef.current) {
          analyserRef.current.getByteFrequencyData(dataArray);
          const avg = dataArray.reduce((a, b) => a + b) / dataArray.length;
          setAudioLevel(avg / 255);
          animationFrameRef.current = requestAnimationFrame(updateLevel);
        }
      };
      updateLevel();

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: "audio/webm;codecs=opus",
      });

      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, {
          type: "audio/webm",
        });
        stream.getTracks().forEach((track) => track.stop());
        await transcribeAudio(audioBlob);
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start(100); // Collect data every 100ms
      setIsRecording(true);

      if (window.electronAPI) {
        window.electronAPI.setRecordingState(true);
      }
    } catch (err) {
      console.error("Failed to start recording:", err);
      setError("Failed to access microphone");
    }
  }, []);

  // Stop recording
  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setAudioLevel(0);
      cancelAnimationFrame(animationFrameRef.current);
      analyserRef.current = null;

      if (window.electronAPI) {
        window.electronAPI.setRecordingState(false);
      }
    }
  }, [isRecording]);

  // Toggle recording (for mouse click)
  const toggleRecording = useCallback(() => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [isRecording, startRecording, stopRecording]);

  // Transcribe audio using Whisper API (Groq or OpenAI)
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
      formData.append("file", audioBlob, "recording.webm");
      formData.append("response_format", "text");

      // Set API URL and model based on provider
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

      // Copy to clipboard and auto-paste (Wayland compatible)
      if (window.electronAPI && trimmedText) {
        await window.electronAPI.copyToClipboard(trimmedText);
        // Auto-paste using the updated handler (Ctrl+V)
        await window.electronAPI.pasteText(trimmedText);
      }
    } catch (err) {
      console.error("Transcription failed:", err);
      setError(err instanceof Error ? err.message : "Transcription failed");
    } finally {
      setIsTranscribing(false);
    }
  };

  // Handle paste action
  const handlePaste = async () => {
    if (transcription && window.electronAPI) {
      await window.electronAPI.pasteText(transcription);
      // Don't hide window - let user decide when to close
    }
  };

  // Handle copy action
  const handleCopy = async () => {
    if (transcription && window.electronAPI) {
      await window.electronAPI.copyToClipboard(transcription);
    }
  };

  // Listen for Electron events
  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.onStartRecording(() => {
        startRecording();
      });

      window.electronAPI.onStopRecording(() => {
        stopRecording();
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
  }, [startRecording, stopRecording]);

  return (
    <div className="glass rounded-2xl p-4 w-full h-full flex flex-col box-border overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
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
          {/* Paste button - only show when transcription exists */}
          {transcription && !isRecording && !isTranscribing && (
            <button
              data-no-drag
              onClick={handlePaste}
              className="w-7 h-7 rounded-full bg-primary-500/80 hover:bg-primary-500 flex items-center justify-center transition-colors"
              title="Paste"
            >
              <svg
                className="w-3.5 h-3.5 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                />
              </svg>
            </button>
          )}
          {/* Copy button - only show when transcription exists */}
          {transcription && !isRecording && !isTranscribing && (
            <button
              data-no-drag
              onClick={handleCopy}
              className="w-7 h-7 rounded-full hover:bg-white/10 flex items-center justify-center transition-colors"
              title="Copy"
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
          {/* Settings button */}
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
        <div className="flex-1 flex flex-col">
          {/* Recording Indicator */}
          <RecordingIndicator
            isRecording={isRecording}
            isTranscribing={isTranscribing}
            audioLevel={audioLevel}
            onToggleRecording={toggleRecording}
            hotkey="Shift+Space"
          />

          {/* Error message */}
          {error && (
            <div className="mt-2 p-2 bg-red-500/20 rounded-lg text-red-400 text-xs text-center">
              {error}
            </div>
          )}

          {/* Transcription display */}
          {transcription && !isRecording && !isTranscribing && (
            <div className="mt-2">
              <TranscriptionDisplay text={transcription} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default App;
