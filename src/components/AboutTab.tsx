import { IconAbout, IconMic, IconRecord, IconBars, IconProcess, IconInsert, IconShield } from "./ui/icons";
import type { ComponentType, SVGProps } from "react";
import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { SectionCard } from "./SectionCard";
import { APP_NAME, storageKey } from "../appConfig";
import { WisperLogo } from "./WisperLogo";

const GITHUB_REPO = "taraksh01/wisper";

/* One-off animations for this page.
   pipe-flow: data streaming left → right (one gradient period = 7px).
   caret-blink: terminal-style instant blink on the Insert icon. */
const ABOUT_CSS = `
@keyframes pipe-flow { to { background-position-x: 7px; } }
@keyframes caret-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
  .animate-\\[pipe-flow_0\\.7s_linear_infinite\\],
  .animate-\\[caret-blink_1\\.1s_steps\\(1\\)_infinite\\] { animation: none; }
}`;

interface Step {
  label: string;
  desc: string;
  optional?: boolean;
  blink?: boolean;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
}

const STEPS: Step[] = [
  { label: "Speak", desc: "Hold your hotkey and talk.", Icon: IconMic },
  { label: "Record", desc: "Captured right on your device.", Icon: IconRecord },
  { label: "Transcribe", desc: "Your voice becomes text.", Icon: IconBars },
  { label: "Refine", desc: "AI cleans up and formats it.", optional: true, Icon: IconProcess },
  { label: "Insert", desc: "Typed at your cursor or copied.", blink: true, Icon: IconInsert },
];

export function AboutTab() {
  const [version, setVersion] = useState("");
  const [stars, setStars] = useState<number | null>(null);

  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    const cached = sessionStorage.getItem(`gh-stars:${GITHUB_REPO}`);
    if (cached) {
      const n = parseInt(cached, 10);
      if (Number.isFinite(n)) setStars(n);
      return;
    }
    fetch(`https://api.github.com/repos/${GITHUB_REPO}`, { signal: ac.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data) => {
        if (typeof data?.stargazers_count === "number") {
          setStars(data.stargazers_count);
          try {
            sessionStorage.setItem(`gh-stars:${GITHUB_REPO}`, String(data.stargazers_count));
          } catch {}
        }
      })
      .catch((e) => {
        if ((e as Error)?.name !== "AbortError") {
          // silent, rate-limit or offline
        }
      });
    return () => ac.abort();
  }, []);

  return (
    <div className="w-full space-y-4 card-enter">
      <style>{ABOUT_CSS}</style>
      <div className="flex items-center gap-2">
        <IconAbout className="w-5 h-5 text-accent" />
        <h1 className="text-sm font-semibold text-ink tracking-tight">About</h1>
      </div>

      {/* ── Hero: brand moment ── */}
      <SectionCard className="card-enter relative overflow-hidden">
        <div
          className="pointer-events-none absolute inset-x-0 -top-10 h-56"
          style={{
            background:
              "radial-gradient(ellipse 55% 90% at 50% 0%, color-mix(in srgb, var(--color-accent) 22%, transparent), transparent 70%)",
          }}
        />
        <div className="relative text-center pt-6 pb-2">
          <WisperLogo
            className="logo-idle-eq w-[72px] h-[72px] mx-auto rounded-[20px] shadow-card"
            background
          />
          <h2 className="text-xl font-bold font-mono text-ink tracking-tight mt-4">
            {APP_NAME}
          </h2>
          <p className="text-[10px] font-mono text-muted mt-1 tracking-[0.16em] uppercase">
            Version {version}
          </p>
          <p className="text-xs text-muted leading-relaxed mt-3 max-w-[430px] mx-auto">
            Your voice, typed anywhere. Hold your shortcut key, speak, and your words
            appear as text, transcribed{" "}
            <span className="text-ink font-medium">on your own machine</span>, ready
            to paste into whatever you're doing.
          </p>
        </div>
      </SectionCard>

      {/* ── How it works: horizontal pipeline ── */}
      <SectionCard title="How it works" className="card-enter">
        <div className="flex items-start py-1">
          {STEPS.map((step, i) => (
            <div key={step.label} className="contents">
              {i > 0 && (
                <div
                  className={`animate-[pipe-flow_0.7s_linear_infinite] shrink-0 w-7 h-0.5 self-start mt-[21px] ${
                    step.optional
                      ? "bg-[repeating-linear-gradient(90deg,color-mix(in_srgb,var(--color-muted)_45%,transparent)_0_3px,transparent_3px_7px)]"
                      : "bg-[repeating-linear-gradient(90deg,color-mix(in_srgb,var(--color-accent)_75%,transparent)_0_3px,transparent_3px_7px)]"
                  }`}
                />
              )}
              <div className="flex-1 min-w-0 text-center card-enter" style={{ animationDelay: `${i * 70}ms` }}>
                <div
                  className={`w-11 h-11 mx-auto rounded-[13px] flex items-center justify-center ring-1 ${
                    step.optional
                      ? "bg-transparent ring-stroke border border-dashed border-stroke text-muted"
                      : "bg-accent/10 ring-accent/30 text-accent shadow-[0_0_16px_-6px] shadow-accent/55"
                  }`}
                >
                  <step.Icon
                    className={`w-[19px] h-[19px] ${
                      step.blink ? "animate-[caret-blink_1.1s_steps(1)_infinite]" : ""
                    }`}
                  />
                </div>
                <h3 className={`text-xs font-semibold font-mono mt-2.5 ${step.optional ? "text-muted" : "text-ink"}`}>
                  {step.label}
                  {step.optional && (
                    <span className="ml-1.5 align-middle text-[7.5px] font-mono font-normal text-muted tracking-[0.1em] uppercase px-1 py-0.5 rounded ring-1 ring-stroke">
                      optional
                    </span>
                  )}
                </h3>
                <p className="text-[10px] text-muted leading-snug mt-1 px-1">{step.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* ── Privacy ── */}
      <SectionCard className="card-enter">
        <div className="flex items-start gap-3.5">
          <div className="shrink-0 w-[38px] h-[38px] rounded-xl flex items-center justify-center bg-accent/10 ring-1 ring-accent/30 text-accent">
            <IconShield className="w-[18px] h-[18px]" />
          </div>
          <div className="min-w-0">
            <h3 className="text-xs font-medium text-ink">Private by default</h3>
            <p className="text-[11px] text-muted leading-relaxed mt-1 max-w-[520px]">
              Audio is transcribed by models running entirely on this machine, so nothing is
              uploaded and no account is needed. Cloud engines exist if you want them, but
              they're strictly opt-in.
            </p>
          </div>
        </div>
      </SectionCard>

      {/* ── Links ── */}
      <SectionCard className="card-enter">
        <div className="flex items-center gap-2.5">
          <a
            href="https://github.com/taraksh01/wisper"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-mono text-accent bg-accent-soft ring-1 ring-accent/30 hover:bg-accent/15 rounded-lg transition-colors pressable"
          >
            <svg className="w-[15px] h-[15px] shrink-0" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
            </svg>
            GitHub
          </a>
          {stars !== null && (
            <span
              className="inline-flex items-center gap-1 text-[10px] font-mono text-muted px-1.5 py-0.5 rounded-md bg-elevated/40 ring-1 ring-stroke"
              title={`${stars.toLocaleString()} stars on GitHub`}
            >
              <svg className="w-3 h-3 text-warning" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2l2.9 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l7.1-1.01L12 2z" />
              </svg>
              {stars.toLocaleString()}
            </span>
          )}
        </div>
        <p className="text-[10.5px] text-muted/80 leading-relaxed mt-2.5">
          Free and open source. If Wisper saves you time, a star helps others find it.
        </p>
      </SectionCard>

      {/* ── Setup guide ── */}
      <SectionCard className="card-enter">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-xs font-medium text-ink">Setup guide</h3>
            <p className="text-[10px] font-mono text-muted mt-0.5">See the welcome screen and setup tips again.</p>
          </div>
          <button
            onClick={() => {
              localStorage.removeItem(storageKey("onboarded"));
              location.reload();
            }}
            className="shrink-0 px-3 py-1.5 text-[11px] font-mono text-accent ring-1 ring-stroke hover:bg-elevated/50 rounded-md transition-colors pressable"
          >
            Show again
          </button>
        </div>
      </SectionCard>
    </div>
  );
}
