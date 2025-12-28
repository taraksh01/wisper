import { useEffect, useRef } from "react";

interface WaveformProps {
  audioLevel: number;
  isRecording: boolean;
  onClick?: () => void;
}

export function Waveform({ audioLevel, isRecording, onClick }: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number>(0);
  // Store previous bar heights for smooth interpolation
  const prevBarsRef = useRef<number[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const centerY = height / 2;

    // Increased bar count for higher resolution
    const barCount = 29;
    const barWidth = 3;
    const gap = 2;
    const totalWidth = barCount * (barWidth + gap) - gap;
    const startX = (width - totalWidth) / 2;
    const centerIndex = Math.floor(barCount / 2);

    // Initialize prevBars if size changed
    if (prevBarsRef.current.length !== barCount) {
      prevBarsRef.current = new Array(barCount).fill(2);
    }

    const draw = () => {
      ctx.clearRect(0, 0, width, height);

      // Create gradient
      const gradient = ctx.createLinearGradient(0, height, 0, 0);
      gradient.addColorStop(0, "#e95420");
      gradient.addColorStop(1, "#ff8a65");

      // Lower threshold for better sensitivity
      const speakingThreshold = 0.01;
      const isSpeaking = isRecording && audioLevel > speakingThreshold;

      for (let i = 0; i < barCount; i++) {
        const distFromCenter = Math.abs(i - centerIndex);
        const maxDist = centerIndex + 1;
        // Smoother bell curve falloff
        const positionScale = Math.exp(
          -Math.pow(distFromCenter / (maxDist * 0.6), 2)
        );

        let targetHeight: number;

        if (isSpeaking) {
          // Dynamic parameters
          const time = Date.now() / 150; // Slower time for smoother waves
          const wave = Math.sin(time + i * 0.2) * 0.3 + 0.7; // Moving wave
          const jitter = Math.random() * 0.1; // Slight jitter for liveliness

          // Boost audio level sensitivity non-linearly
          const sensitiveLevel = Math.pow(audioLevel * 2.5, 0.8);

          targetHeight = Math.max(
            4,
            sensitiveLevel * positionScale * wave * height * 0.8 +
              jitter * height * 0.1
          );
        } else {
          // Idle state - gentle breathing
          const idleTime = Date.now() / 1000;
          const idleWave = Math.sin(idleTime + i * 0.1) * 0.1 + 0.9;
          targetHeight = 3 + positionScale * idleWave * 3;
        }

        // Smooth interpolation (LERP)
        // Adjust speed for rise vs fall
        const riseSpeed = 0.25;
        const fallSpeed = 0.15;
        const currentHeight = prevBarsRef.current[i];
        const speed = targetHeight > currentHeight ? riseSpeed : fallSpeed;

        const smoothedHeight =
          currentHeight + (targetHeight - currentHeight) * speed;
        prevBarsRef.current[i] = smoothedHeight;

        // Draw pill-shaped bar
        const x = startX + i * (barWidth + gap);
        const y = centerY - smoothedHeight / 2;

        ctx.fillStyle = isSpeaking ? gradient : "rgba(255, 255, 255, 0.2)";
        ctx.beginPath();
        // Use standard rounded rect or fallback
        if (ctx.roundRect) {
          ctx.roundRect(x, y, barWidth, smoothedHeight, 10);
        } else {
          ctx.rect(x, y, barWidth, smoothedHeight);
        }
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
