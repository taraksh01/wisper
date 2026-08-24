import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { IconCloseSmall } from "./icons";

type InputVariant = "default" | "ghost" | "surface";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  variant?: InputVariant;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  onClear?: () => void;
}

/**
 * Single source for all text/number/search inputs.
 * - default: bg-elevated/50 with ring focus
 * - ghost: transparent bg for inline editing (suggestion rows)
 * - surface: bg-surface with border (Field style)
 * - leftIcon / rightIcon: rendered inside the field (no external absolute wrapper needed)
 * - onClear: shows an X button inside on the right when value is non-empty
 * Pass className to override width/padding. When icons are used, padding is auto-adjusted.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ variant = "default", className = "", leftIcon, rightIcon, onClear, value, ...props }, ref) => {
    const base =
      "text-xs font-mono text-ink placeholder:text-muted/50 outline-none transition-all disabled:opacity-50 disabled:cursor-not-allowed";
    const variantCls =
      variant === "ghost"
        ? "bg-transparent"
        : variant === "surface"
        ? "bg-surface border border-stroke rounded-xl px-3.5 py-2.5 shadow-[inset_0_1px_0_var(--color-stroke-soft)] focus:border-accent/40 focus:ring-2 focus:ring-accent/15"
        : "bg-elevated/50 rounded-lg px-2.5 py-1.5 ring-1 ring-stroke focus:ring-accent/50";

    const hasLeft = !!leftIcon;
    const showClear = !!onClear && value !== undefined && String(value).length > 0;
    const hasRight = !!rightIcon || showClear;
    const needsWrapper = hasLeft || hasRight;

    if (!needsWrapper) {
      return <input ref={ref} className={`${base} ${variantCls} w-full ${className}`} value={value} {...props} />;
    }

    const padLeft = hasLeft ? "pl-9" : "";
    const padRight = hasRight ? "pr-9" : "";

    return (
      <div className="relative w-full">
        {leftIcon && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none flex items-center">
            {leftIcon}
          </span>
        )}
        <input
          ref={ref}
          className={`${base} ${variantCls} w-full ${padLeft} ${padRight} ${className}`}
          value={value}
          {...props}
        />
        {showClear ? (
          <button
            type="button"
            onClick={onClear}
            onMouseDown={(e) => e.preventDefault()}
            aria-label="Clear"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 w-6 h-6 grid place-items-center rounded-full text-muted hover:text-ink hover:bg-elevated transition-colors"
          >
            <IconCloseSmall className="w-3 h-3" />
          </button>
        ) : rightIcon ? (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted flex items-center pointer-events-none">
            {rightIcon}
          </span>
        ) : null}
      </div>
    );
  }
);
Input.displayName = "Input";
