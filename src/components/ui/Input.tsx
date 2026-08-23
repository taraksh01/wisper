import { forwardRef, type InputHTMLAttributes } from "react";

type InputVariant = "default" | "ghost" | "surface";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  variant?: InputVariant;
}

/**
 * Single source for all text/number/search inputs.
 * - default: bg-elevated/50 with ring focus
 * - ghost: transparent bg for inline editing (suggestion rows)
 * - surface: bg-surface with border (Field style)
 * Pass className to override width/padding (e.g. w-28, pl-8).
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ variant = "default", className = "", ...props }, ref) => {
    const base =
      "text-xs font-mono text-ink placeholder:text-muted/50 outline-none transition-all disabled:opacity-50 disabled:cursor-not-allowed";
    const variantCls =
      variant === "ghost"
        ? "bg-transparent"
        : variant === "surface"
        ? "bg-surface border border-stroke rounded-xl px-3.5 py-2.5 shadow-[inset_0_1px_0_var(--color-stroke-soft)] focus:border-accent/40 focus:ring-2 focus:ring-accent/15"
        : "bg-elevated/50 rounded-lg px-2.5 py-1.5 ring-1 ring-stroke focus:ring-accent/50";
    return <input ref={ref} className={`${base} ${variantCls} ${className}`} {...props} />;
  }
);
Input.displayName = "Input";
