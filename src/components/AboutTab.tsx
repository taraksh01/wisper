import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { SectionCard } from "./SectionCard";
import { WisperLogo } from "./WisperLogo";

const GITHUB_REPO = "taraksh01/wisper";

export function AboutTab() {
  const [version, setVersion] = useState("");
  const [stars, setStars] = useState<number | null>(null);

  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
  }, []);

  useEffect(() => {
    fetch(`https://api.github.com/repos/${GITHUB_REPO}`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => {
        if (typeof data?.stargazers_count === "number") {
          setStars(data.stargazers_count);
        }
      })
      .catch(() => {});
  }, []);

  return (
    <div className="max-w-lg space-y-4 card-enter">
      <div className="flex items-center gap-2">
        <svg className="w-5 h-5 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
        <h1 className="text-sm font-semibold text-ink tracking-tight">About</h1>
      </div>

      <SectionCard className="card-enter">
        <div className="text-center py-2">
          <WisperLogo className="w-14 h-14 mx-auto rounded-2xl" background />
          <h2 className="text-lg font-bold font-mono text-ink mt-3">Wisper</h2>
          <p className="text-[10px] font-mono text-muted mt-0.5 tracking-wider uppercase">Version {version}</p>
        </div>
        <p className="text-xs text-muted leading-relaxed mt-3 text-center">
          Turn your voice into text right on your device, with your privacy always in your hands.
          Just speak, and your words are ready to paste anywhere. Everything stays on your computer
          by default, with optional cloud providers available whenever you choose to use them.
        </p>
      </SectionCard>

      <SectionCard title="How it works" className="card-enter">
        <div className="relative py-1">
          <div className="space-y-1">
            {[
              { label: "Speak", desc: "Hold your hotkey and talk.", d: "M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8" },
              { label: "Record", desc: "Captured right on your device.", d: "M2 12h2M6 8v8M10 4v16M14 7v10M18 9v6" },
              { label: "Transcribe", desc: "Your voice becomes text.", d: "M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2M9 20h6M12 4v16" },
              { label: "Refine", desc: "AI cleans up and formats it.", optional: true, d: "M12 4l1.6 4L18 9.5l-4.4 1.6L12 15l-1.6-4L6 9.5l4.4-1.5L12 4z" },
              { label: "Insert", desc: "Typed at your cursor or copied.", d: "M17 22h-1a4 4 0 0 1-4-4V6a4 4 0 0 1 4-4h1M7 22h1a4 4 0 0 0 4-4V6a4 4 0 0 0-4-4H7" },
            ].map((step, i, arr) => {
              const left = i % 2 === 0;
              const accent = !step.optional;
              const isLast = i === arr.length - 1;
              const content = (
                <div className={`min-w-0 ${left ? "text-right pr-3" : "text-left pl-3"}`}>
                  <div className={`flex items-center gap-1.5 ${left ? "justify-end" : "justify-start"}`}>
                    <span className="text-xs font-mono text-ink font-semibold">{step.label}</span>
                    {step.optional && (
                      <span className="text-[7px] font-mono text-muted tracking-[0.1em] uppercase px-1 py-0.5 rounded ring-1 ring-stroke">
                        optional
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-muted leading-snug mt-0.5">{step.desc}</p>
                </div>
              );

              return (
                <div
                  key={step.label}
                  className="grid grid-cols-[1fr_auto_1fr] items-center card-enter"
                  style={{ animationDelay: `${i * 90}ms` }}
                >
                  {left ? content : <div />}

                  {/* node */}
                  <div className="relative flex flex-col items-center py-1.5">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center ring-1 ${
                        accent
                          ? "bg-accent/10 ring-accent/30 shadow-[0_0_12px_-4px] shadow-accent/40"
                          : "bg-elevated/40 ring-stroke ring-dashed"
                      }`}
                    >
                      <svg
                        className={`w-4 h-4 ${accent ? "text-accent" : "text-muted"}`}
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d={step.d} />
                      </svg>
                    </div>
                    {!isLast && (
                      <div className="absolute top-full left-1/2 -translate-x-1/2 h-2 w-0 border-l border-dashed border-accent/50" />
                    )}
                  </div>

                  {left ? <div /> : content}
                </div>
              );
            })}
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Links" className="card-enter">
        <div className="space-y-3">
          <div className="flex items-center gap-2.5">
            <a
              href="https://github.com/taraksh01/wisper"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-xs font-mono text-accent hover:text-accent-dim transition-colors"
            >
              <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
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

          <p className="text-[11px] text-muted leading-relaxed">
            Free and open source. Show your love by giving it a star on GitHub.
          </p>
        </div>
      </SectionCard>
    </div>
  );
}
