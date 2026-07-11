import { useId } from "react";

type LogoState = "idle" | "recording" | "processing";

// Base heights of the five bars (from the icon design), in viewBox units.
const BASE = [128, 224, 300, 224, 128];
const CY = 256; // vertical center of the 512 viewBox
// How strongly each bar reacts to the live level (center bars react most).
const REACT = [0.6, 0.85, 1, 0.85, 0.6];

export function WisperLogo({
  className = "w-5 h-5",
  state = "idle",
  level = 0,
  background = false,
}: {
  className?: string;
  state?: LogoState;
  /** Live input amplitude 0..1, used when state === "recording". */
  level?: number;
  /** Render the filled squircle background (for brand showcase, e.g. About). */
  background?: boolean;
}) {
  const uid = useId();
  const wave = `wisper-wave-${uid}`;
  const bg = `wisper-bg-${uid}`;
  const reacting = state === "recording";

  // Map raw RMS (~0..0.3 typical speech) to a 0..1 display range.
  const norm = Math.min(1, Math.max(0, level / 0.25));

  return (
    <svg
      className={`${className} ${state === "processing" ? "wisper-logo--processing" : ""}`}
      viewBox="0 0 512 512"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={wave} x1="256" y1="96" x2="256" y2="416" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fb923c" />
          <stop offset="1" stopColor="#ea580c" />
        </linearGradient>
        {background && (
          <linearGradient id={bg} x1="0" y1="0" x2="512" y2="512" gradientUnits="userSpaceOnUse">
            <stop stopColor="#1a1a1a" />
            <stop offset="1" stopColor="#050505" />
          </linearGradient>
        )}
      </defs>
      {background && (
        <>
          <rect width="512" height="512" rx="112" fill={`url(#${bg})`} />
          <rect x="1" y="1" width="510" height="510" rx="111" stroke="#ffffff" strokeOpacity="0.06" strokeWidth="2" />
        </>
      )}
      <g fill={`url(#${wave})`}>
        {BASE.map((base, i) => {
          const x = 72 + i * 80;
          let height = base;
          if (reacting) {
            // idle floor at ~18% of base, growing toward full base height with level
            const floor = base * 0.18;
            height = floor + (base - floor) * norm * REACT[i];
          }
          const y = CY - height / 2;
          return (
            <rect
              key={i}
              className="wisper-bar"
              x={x}
              y={y}
              width={48}
              height={height}
              rx={24}
              style={reacting ? { transition: "y 80ms linear, height 80ms linear" } : undefined}
            />
          );
        })}
      </g>
    </svg>
  );
}
