import { useCallback, useEffect, useRef } from "react";
import { Button } from "./ui/Button";
import { IconStop, IconPlay, IconPause } from "./ui/icons";

interface AudioPlayerPopoverProps {
  /** Downsampled peak amplitudes (0..1) for the waveform; null while decoding. */
  peaks: Float32Array | null;
  playing: boolean;
  time: number;
  duration: number;
  /** Playback speed, persisted by the parent across recordings. */
  speed: number;
  onSpeedChange: (rate: number) => void;
  onToggle: () => void;
  onSeek: (fraction: number) => void;
  onClose: () => void;
}

const fmt = (t: number) =>
  `${Math.floor(t / 60)}:${Math.floor(t % 60).toString().padStart(2, "0")}`;

export function AudioPlayerPopover({
  peaks,
  playing,
  time,
  duration,
  speed,
  onSpeedChange,
  onToggle,
  onSeek,
  onClose,
}: AudioPlayerPopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Close on Escape / click outside
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onMouseDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onMouseDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onMouseDown);
    };
  }, [onClose]);

  // ── Waveform drawing ──
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    canvas.width = cw * dpr;
    canvas.height = ch * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, cw, ch);

    const accent = getComputedStyle(document.documentElement)
      .getPropertyValue("--color-accent")
      .trim() || "#7c3aed";
    const muted = getComputedStyle(document.documentElement)
      .getPropertyValue("--color-stroke")
      .trim() || "#1f1f1f";

    const frac = duration > 0 ? Math.min(1, time / duration) : 0;
    const barW = 3;
    const gap = 2;
    const count = Math.floor(cw / (barW + gap));
    const mid = ch / 2;

    for (let i = 0; i < count; i++) {
      const p = peaks
        ? peaks[Math.min(peaks.length - 1, Math.floor((i / count) * peaks.length))]
        : 0.15;
      const h = Math.max(2, p * (ch - 6));
      const x = i * (barW + gap);
      const y = mid - h / 2;
      ctx.fillStyle = i / count <= frac ? accent : muted;
      ctx.beginPath();
      ctx.roundRect(x, y, barW, h, 2);
      ctx.fill();
    }

    // playhead
    ctx.fillStyle = accent;
    ctx.fillRect(Math.min(cw - 1, frac * cw), 0, 1.5, ch);
  }, [peaks, time, duration]);

  useEffect(() => {
    draw();
  }, [draw]);
  useEffect(() => {
    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
  }, [draw]);

  // ── Seek via click / drag on the waveform ──
  const seekFromCanvas = useCallback(
    (clientX: number) => {
      const r = canvasRef.current?.getBoundingClientRect();
      if (!r) return;
      onSeek(Math.min(1, Math.max(0, (clientX - r.left) / r.width)));
    },
    [onSeek]
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Invisible backdrop: click anywhere outside closes */}
      <div className="absolute inset-0" onMouseDown={onClose} />
      <div
        ref={panelRef}
        className="relative w-[340px] bg-surface border border-stroke rounded-xl shadow-[var(--shadow-card-hover)] p-4 panel-enter"
      >
        <canvas
          ref={canvasRef}
          onMouseDown={(e) => {
            seekFromCanvas(e.clientX);
            const move = (ev: MouseEvent) => seekFromCanvas(ev.clientX);
            const up = () => {
              document.removeEventListener("mousemove", move);
              document.removeEventListener("mouseup", up);
            };
            document.addEventListener("mousemove", move);
            document.addEventListener("mouseup", up);
          }}
          className="w-full h-12 cursor-pointer"
        />

        <div className="flex items-center gap-2.5 mt-3">
          <Button
            variant="primary"
            onClick={onToggle}
            className="w-8 h-8 rounded-full"
            title={playing ? "Pause" : "Play"}
          >
            {playing ? <IconPause className="w-3.5 h-3.5" /> : <IconPlay className="w-3.5 h-3.5 ml-0.5" />}
          </Button>
          <span className="text-[10px] font-mono text-muted tabular-nums">
            {fmt(time)} / {fmt(duration)}
          </span>

          <div
            className="ml-auto flex items-center gap-2"
            title="Playback speed (saved as your preference)"
          >
            <span className="text-[10px] font-mono text-accent tabular-nums w-8 text-right">
              {speed}×
            </span>
            <input
              type="range"
              min={0.5}
              max={2.5}
              step={0.25}
              value={speed}
              onChange={(e) => onSpeedChange(parseFloat(e.target.value))}
              className="w-[72px] accent-accent cursor-pointer"
              aria-label="Playback speed"
            />
          </div>

          <Button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-recording text-white hover:bg-recording/80"
            title="Close"
          >
            <IconStop className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
