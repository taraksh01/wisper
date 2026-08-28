import type { ReactNode } from "react";

interface StatPillProps {
  children: ReactNode;
  variant?: "default" | "accent";
  dot?: boolean;
  dotClass?: string;
}

/**
 * Single source for all stat pills — bottom bar, History stats, Sidebar model pill.
 * Uses tokens from styles.css (--color-elevated, --color-accent-soft, --color-stroke)
 */
export function StatPill({ children, variant = "default", dot = false, dotClass }: StatPillProps) {
  const base = "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-mono";
  const variantCls =
    variant === "accent"
      ? "bg-accent-soft border-accent/15 text-ink/80"
      : "bg-elevated border-stroke text-muted";
  return (
    <span className={`${base} ${variantCls}`}>
      {dot && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotClass ?? (variant === "accent" ? "bg-accent" : "bg-ink/20")}`} />}
      {children}
    </span>
  );
}
