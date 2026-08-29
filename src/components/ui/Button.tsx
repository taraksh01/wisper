import type { ButtonHTMLAttributes } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary = filled accent, ghost = quiet text-only */
  variant?: "primary" | "ghost";
}

/**
 * Single source for all icon/action buttons - audio player, history rows, etc.
 * Size and shape come from the caller via className.
 */
export function Button({ variant = "ghost", className = "", children, ...rest }: ButtonProps) {
  const base =
    "inline-flex items-center justify-center shrink-0 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50 disabled:pointer-events-none";
  const variantCls =
    variant === "primary"
      ? "bg-accent text-white hover:bg-accent-dim"
      : "text-muted hover:text-ink";
  return (
    <button className={`${base} ${variantCls} ${className}`} {...rest}>
      {children}
    </button>
  );
}
