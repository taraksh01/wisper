import { useEffect, useRef } from "react";

interface WaveformProps {
  audioLevel: number;
  isRecording: boolean;
  onClick?: () => void;
}

export function Waveform({ audioLevel, isRecording, onClick }: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const centerY = height / 2;

    const draw = () => {
      ctx.clearRect(0, 0, width, height);

      // Wave parameters
      const barCount = 13;
      const barWidth = 4;
      const gap = 3;
      const totalWidth = barCount * (barWidth + gap) - gap;
      const startX = (width - totalWidth) / 2;
      const centerIndex = Math.floor(barCount / 2);

      // Create gradient
      const gradient = ctx.createLinearGradient(0, height, 0, 0);
      gradient.addColorStop(0, "#e95420");
      gradient.addColorStop(1, "#ff8a65");

      // Speaking threshold
      const speakingThreshold = 0.05;
      const isSpeaking = isRecording && audioLevel > speakingThreshold;

      for (let i = 0; i < barCount; i++) {
        const distFromCenter = Math.abs(i - centerIndex);
        const maxDist = centerIndex + 1;
        const positionScale = 1 - Math.pow(distFromCenter / maxDist, 1.5);

        let barHeight: number;

        if (isSpeaking) {
          // Animated wave when speaking
          const animVariation =
            Math.sin(Date.now() / 100 + i * 0.5) * 0.2 + 0.8;
          barHeight = Math.max(
            4,
            audioLevel * positionScale * animVariation * height * 0.9
          );
          if (barHeight < 6 && audioLevel > 0.1) barHeight = 6;
        } else {
          // Thin idle wave - subtle animated line
          const idleVariation =
            Math.sin(Date.now() / 500 + i * 0.3) * 0.3 + 0.7;
          barHeight = 2 + positionScale * idleVariation * 2;
        }

        const x = startX + i * (barWidth + gap);
        const y = centerY - barHeight / 2;

        ctx.fillStyle = isSpeaking ? gradient : "rgba(255, 255, 255, 0.3)";
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, 2);
        ctx.fill();
      }

      animationFrameRef.current = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      cancelAnimationFrame(animationFrameRef.current);
    };
  }, [audioLevel, isRecording]);

  return (
    <div
      className="flex items-center justify-center py-2 cursor-pointer"
      onClick={onClick}
    >
      <canvas ref={canvasRef} width={150} height={48} />
    </div>
  );
}
