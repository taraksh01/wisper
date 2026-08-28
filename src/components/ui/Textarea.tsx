import { forwardRef, type TextareaHTMLAttributes, type ReactNode } from "react";
import { IconCloseSmall } from "./icons";

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  onClear?: () => void;
  rightIcon?: ReactNode;
}

/**
 * Single source for all textareas (history item editing, import modal, process prompt).
 * - onClear: shows an X button inside the top-right when value is non-empty
 * - rightIcon: decorative icon in the top-right
 */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className = "", onClear, rightIcon, value, ...props }, ref) => {
    const showClear = !!onClear && value !== undefined && String(value).length > 0;
    const hasRight = !!rightIcon || showClear;
    if (!hasRight) {
      return (
        <textarea
          ref={ref}
          value={value}
          className={`w-full bg-elevated/50 rounded-lg px-2.5 py-2 text-xs font-mono text-ink placeholder:text-muted/50 outline-none ring-1 ring-stroke focus:ring-accent/40 resize-none transition-all ${className}`}
          {...props}
        />
      );
    }
    return (
      <div className="relative w-full">
        <textarea
          ref={ref}
          value={value}
          className={`w-full bg-elevated/50 rounded-lg px-2.5 py-2 pr-9 text-xs font-mono text-ink placeholder:text-muted/50 outline-none ring-1 ring-stroke focus:ring-accent/40 resize-none transition-all ${className}`}
          {...props}
        />
        {showClear ? (
          <button
            type="button"
            onClick={onClear}
            onMouseDown={(e) => e.preventDefault()}
            aria-label="Clear"
            className="absolute right-1.5 top-1.5 w-6 h-6 grid place-items-center rounded-full text-muted hover:text-ink hover:bg-elevated transition-colors"
          >
            <IconCloseSmall className="w-3 h-3" />
          </button>
        ) : rightIcon ? (
          <span className="absolute right-2.5 top-2.5 text-muted flex items-center pointer-events-none">
            {rightIcon}
          </span>
        ) : null}
      </div>
    );
  }
);
Textarea.displayName = "Textarea";
