interface OnboardingProps {
  env: { reliable: boolean; has_wtype: boolean; has_ydotool: boolean } | null;
  onDone: () => void;
}

import type { ComponentType, SVGProps } from "react";
import { APP_NAME, iconSrc } from "../appConfig";
import { IconDownload, IconMic, IconBars, IconProcess, IconInsert } from "./ui/icons";

const steps: {
  title: string;
  desc: string;
  optional?: boolean;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
}[] = [
  {
    Icon: IconDownload,
    title: "Setup",
    desc: "Download an on-device model or connect cloud in the Engine tab.",
  },
  {
    Icon: IconMic,
    title: "Speak",
    desc: "Hold your shortcut key and just talk.",
  },
  {
    Icon: IconBars,
    title: "Transcribe",
    desc: "Your words become text instantly.",
  },
  {
    Icon: IconProcess,
    title: "Refine",
    desc: "Let AI clean up and format the text if you enable it.",
    optional: true,
  },
  {
    Icon: IconInsert,
    title: "Insert",
    desc: "The text appears wherever your cursor is, in any app.",
  },
];

export function Onboarding({ env, onDone }: OnboardingProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-base/80 backdrop-blur-sm p-4">
      <div className="bg-surface border border-stroke rounded-2xl p-8 max-w-md w-full shadow-2xl">
        {/* Hero: Brand logo + tagline */}
        <div className="flex flex-col items-center text-center space-y-4 mb-6">
          <img src={iconSrc} alt={APP_NAME} className="w-16 h-16 rounded-2xl" />
          <div>
            <h1 className="text-base font-bold font-mono text-ink tracking-tight">Welcome to {APP_NAME}</h1>
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
              className="flex items-center gap-3 bg-elevated/40 rounded-xl px-3 py-3.5 ring-1 ring-stroke"
            >
              <div
                className={`shrink-0 w-7 h-7 flex items-center justify-center rounded-lg ${
                  s.optional
                    ? "bg-transparent ring-1 ring-dashed ring-stroke text-muted"
                    : "bg-accent/10 text-accent"
                }`}
              >
                <s.Icon className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className={`text-[11px] font-mono font-semibold leading-none ${s.optional ? "text-muted" : "text-ink"}`}>
                  {s.title}
                  {s.optional && (
                    <span className="ml-1.5 align-middle text-[7.5px] font-mono font-normal text-muted tracking-[0.1em] uppercase px-1 py-0.5 rounded ring-1 ring-stroke">
                      optional
                    </span>
                  )}
                </p>
                <p className="text-[10px] font-mono text-muted mt-1 leading-relaxed">{s.desc}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Wayland paste helper notice: only when the resolved backend is unreliable */}
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
