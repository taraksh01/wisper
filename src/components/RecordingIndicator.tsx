import { useEffect, useRef } from "react";

interface RecordingIndicatorProps {
  isRecording: boolean;
  isTranscribing: boolean;
  audioLevel?: number;
  onToggleRecording?: () => void;
  hotkey?: string; // Current hotkey to display
}

export default function RecordingIndicator({
  isRecording,
  isTranscribing,
  audioLevel = 0,
  onToggleRecording,
  hotkey = "Shift+Space",
}: RecordingIndicatorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Draw waveform based on audio level - only show when speaking
  // Draw waveform based on audio level - symmetric reduced edges
  useEffect(() => {
    if (!isRecording || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);

    // Only draw waveform if audio level is above threshold (user is speaking)
    const speakingThreshold = 0.05;
    if (audioLevel < speakingThreshold) return;

    // Symmetric layout - odd number of bars ensures a center bar
    const barCount = 13;
    const barWidth = 4;
    const gap = 3;
    const centerIndex = Math.floor(barCount / 2);

    // Use primary color (Ubuntu orange)
    const gradient = ctx.createLinearGradient(0, height, 0, 0);
    gradient.addColorStop(0, "#e95420"); // Ubuntu orange
    gradient.addColorStop(1, "#ff8a65"); // Lighter orange

    for (let i = 0; i < barCount; i++) {
      // Calculate distance from center (0 at center, higher at edges)
      const distFromCenter = Math.abs(i - centerIndex);

      // Scale factor: 1.0 at center, decreasing towards edges
      // Using a bell-curve-ish falloff: 1 - (dist / maxDist)^1.5
      const maxDist = centerIndex + 1;
      const positionScale = 1 - Math.pow(distFromCenter / maxDist, 1.5);

      // Base variation animation - smoother
      const animVariation = Math.sin(Date.now() / 100 + i * 0.5) * 0.2 + 0.8;

      // Final height combines audio level, position scaling, and animation
      // Center bars react more strongly to audio
      let barHeight = Math.max(
        4,
        audioLevel * positionScale * animVariation * height * 0.9
      );

      // Ensure even the smallest bars have some movement if speaking
      if (barHeight < 6 && audioLevel > 0.1) barHeight = 6;

      const x =
        (width - barCount * (barWidth + gap)) / 2 + i * (barWidth + gap);
      const y = (height - barHeight) / 2;

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.roundRect(x, y, barWidth, barHeight, 2);
      ctx.fill();
    }
  }, [isRecording, audioLevel]);

  // Animate canvas during recording
  useEffect(() => {
    if (!isRecording) return;

    const animationFrame = { id: 0 };
    const animate = () => {
      if (canvasRef.current) {
        const ctx = canvasRef.current.getContext("2d");
        if (ctx) {
          // Trigger re-render
          canvasRef.current.dispatchEvent(new Event("redraw"));
        }
      }
      animationFrame.id = requestAnimationFrame(animate);
    };
    animate();

    return () => cancelAnimationFrame(animationFrame.id);
  }, [isRecording]);

  if (isTranscribing) {
    return (
      <div className="flex flex-col items-center justify-center py-4">
        <div className="relative">
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
        </div>
        <p className="mt-3 text-white/60 text-sm">Transcribing...</p>
      </div>
    );
  }

  // Ready state - clickable mic button
  if (!isRecording) {
    return (
      <div className="flex flex-col items-center justify-center py-4">
        <button
          onClick={onToggleRecording}
          data-no-drag
          className="w-14 h-14 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center transition-all hover:scale-105 active:scale-95 cursor-pointer"
          title="Click to start recording"
        >
          <svg
            className="w-7 h-7 text-white/50 hover:text-white/70 transition-colors"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z"
              clipRule="evenodd"
            />
          </svg>
        </button>
        <p className="mt-3 text-white/40 text-sm">
          Click or press{" "}
          <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-white/60 font-mono border border-white/5 shadow-sm">
            {hotkey}
          </kbd>
        </p>
      </div>
    );
  }

  // Recording state - just waveform, click anywhere to stop
  return (
    <div
      className="flex flex-col items-center justify-center py-4 cursor-pointer"
      onClick={onToggleRecording}
      data-no-drag
      title="Click to stop recording"
    >
      {/* Real-time audio waveform visualization */}
      <canvas ref={canvasRef} width={150} height={48} />
    </div>
  );
}
