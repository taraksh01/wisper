import { useState } from "react";
import { IconEye, IconEyeOff } from "./ui/icons";

export function Field({
  label,
  value,
  onChange,
  placeholder,
  secret,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  secret?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <label className="label-soft block mb-1">{label}</label>
      <div className="relative">
        <input
          type={secret && !show ? "password" : "text"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-surface border border-stroke rounded-xl px-3.5 py-2.5 pr-10 text-xs font-mono text-ink placeholder:text-muted/50 outline-none focus:border-accent/40 focus:ring-2 focus:ring-accent/15 shadow-[inset_0_1px_0_var(--color-stroke-soft)] transition-[border-color,box-shadow] duration-150"
          placeholder={placeholder}
        />
        {secret && (
          <button
            type="button"
            onClick={() => setShow(!show)}
            onMouseDown={(e) => e.preventDefault()}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-ink transition-colors"
            aria-label={show ? "Hide value" : "Show value"}
            aria-pressed={show}
          >
            {show ? <IconEyeOff className="w-3.5 h-3.5" /> : <IconEye className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>
    </div>
  );
}
