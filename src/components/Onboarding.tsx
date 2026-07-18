import { WisperLogo } from "./WisperLogo";

interface OnboardingProps {
  env: { reliable: boolean; has_wtype: boolean; has_ydotool: boolean } | null;
  onDone: () => void;
}

const steps = [
  {
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" y1="19" x2="12" y2="23" />
      </svg>
    ),
    title: "Speak",
    desc: "Hold the global hotkey and talk.",
  },
  {
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <path d="M8 12h8" />
        <path d="M12 8v8" />
      </svg>
    ),
    title: "Transcribe",
    desc: "Converted to text on your device.",
  },
  {
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 3h5v5" />
        <path d="M8 3H3v5" />
        <path d="M21 3l-7 7" />
        <path d="M3 3l7 7" />
      </svg>
    ),
    title: "Insert",
    desc: "Text lands wherever your cursor is.",
  },
];

export function Onboarding({ env, onDone }: OnboardingProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-base/80 backdrop-blur-sm p-4">
      <div className="bg-surface border border-stroke rounded-2xl p-8 max-w-sm w-full shadow-2xl">
        {/* Hero: Brand logo + tagline */}
        <div className="flex flex-col items-center text-center space-y-4 mb-6">
          <WisperLogo className="w-16 h-16" state="recording" level={0.12} background />
          <div>
            <h1 className="text-base font-bold font-mono text-ink tracking-tight">Welcome to Wisper</h1>
            <p className="text-[11px] font-mono text-muted mt-1 leading-relaxed max-w-[260px] mx-auto">
              Turn your voice into text, privately on your device.
            </p>
          </div>
        </div>

        {/* Steps */}
        <div className="space-y-2 mb-6">
          {steps.map((s) => (
            <div
              key={s.title}
              className="flex items-center gap-3 bg-elevated/40 rounded-xl px-3 py-2.5 ring-1 ring-stroke"
            >
              <div className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg bg-accent/10 text-accent">
                {s.icon}
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-mono font-semibold text-ink leading-none">{s.title}</p>
                <p className="text-[10px] font-mono text-muted mt-1 leading-relaxed">{s.desc}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Wayland paste helper notice — only when the resolved backend is unreliable */}
        {env && !env.reliable && (
          <div className="mb-5 rounded-xl bg-recording/5 ring-1 ring-recording/20 px-3.5 py-3 space-y-1.5">
            <p className="text-[10px] font-mono font-medium text-recording flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 9v4m0 4h.01" />
                <circle cx="12" cy="12" r="10" strokeOpacity="0.3" />
              </svg>
              Wayland paste helper needed
            </p>
            <p className="text-[10px] font-mono text-muted leading-relaxed">
              Install <span className="text-ink font-medium">ydotool</span> for prompt-free pasting (run <span className="text-ink">ydotoold</span> + add your user to the <span className="text-ink">input</span> group).
            </p>
          </div>
        )}

        {/* CTA */}
        <button
          onClick={onDone}
          className="w-full px-4 py-3 text-xs font-mono font-semibold text-accent ring-1 ring-accent/30 hover:bg-accent/10 rounded-xl transition-colors"
        >
          Get started
        </button>
      </div>
    </div>
  );
}
