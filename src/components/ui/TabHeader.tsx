import type { ReactNode } from "react";

interface TabHeaderProps {
  eyebrow: string;
  title: string;
  subtitle: string;
  action?: ReactNode;
}

/**
 * Single source for every tab header — eyebrow pill + display title + subtitle.
 * Change here, propagates to General/Engine/Process/Words/History/About/Donate.
 * Keeps accent from styles.css var(--color-accent) — no hard-coded color.
 */
export function TabHeader({ eyebrow, title, subtitle, action }: TabHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-accent-soft border border-accent/15 text-[10px] font-semibold tracking-[0.14em] uppercase text-accent">
          <span className="w-1 h-1 rounded-full bg-accent shadow-[0_0_6px_var(--color-accent)]" />
          {eyebrow}
        </div>
        <h1 className="mt-3 text-[24px] font-semibold tracking-[-0.02em] leading-none text-ink">{title}</h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{subtitle}</p>
      </div>
      {action && <div className="shrink-0 pt-1">{action}</div>}
    </div>
  );
}
