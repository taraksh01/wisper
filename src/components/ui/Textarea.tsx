import { forwardRef, type TextareaHTMLAttributes } from "react";

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {}

/**
 * Single source for all textareas (history item editing, import modal, process prompt).
 */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className = "", ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        className={`w-full bg-elevated/50 rounded-lg px-2.5 py-2 text-xs font-mono text-ink placeholder:text-muted/50 outline-none ring-1 ring-stroke focus:ring-accent/40 resize-none transition-all ${className}`}
        {...props}
      />
    );
  }
);
Textarea.displayName = "Textarea";
