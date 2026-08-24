import { useState, useId, type ReactNode } from "react";
import { IconEye, IconEyeOff } from "./ui/icons";
import { Input } from "./ui/Input";

export function Field({
  label,
  value,
  onChange,
  placeholder,
  secret,
  type = "text",
  leftIcon,
  rightIcon,
  onClear,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  secret?: boolean;
  type?: string;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  onClear?: () => void;
}) {
  const [show, setShow] = useState(false);
  const id = useId();
  const inputId = `field-${id}`;
  if (secret) {
    const showClear = !!onClear && value.length > 0;
    return (
      <div className="w-full">
        <label htmlFor={inputId} className="label-soft block mb-1.5">{label}</label>
        <div className="relative w-full">
          <Input
            id={inputId}
            type={show ? "text" : "password"}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            variant="surface"
            className={showClear ? "pr-[68px]" : "pr-10"}
            placeholder={placeholder}
            autoComplete="new-password"
          />
          <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
            {showClear && (
              <button
                type="button"
                onClick={onClear}
                onMouseDown={(e) => e.preventDefault()}
                className="w-6 h-6 grid place-items-center rounded-full text-muted hover:text-ink hover:bg-elevated transition-colors"
                aria-label="Clear"
              >
                <span className="text-[10px] leading-none">✕</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setShow(!show)}
              onMouseDown={(e) => e.preventDefault()}
              className="w-6 h-6 grid place-items-center rounded-full text-muted hover:text-ink hover:bg-elevated transition-colors"
              aria-label={show ? "Hide value" : "Show value"}
              aria-pressed={show}
            >
              {show ? <IconEyeOff className="w-3.5 h-3.5" /> : <IconEye className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="w-full">
      <label htmlFor={inputId} className="label-soft block mb-1.5">{label}</label>
      <Input
        id={inputId}
        type={type}
        inputMode={type === "number" ? "numeric" : undefined}
        min={type === "number" ? 0 : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        variant="surface"
        leftIcon={leftIcon}
        rightIcon={rightIcon}
        onClear={onClear}
        placeholder={placeholder}
      />
    </div>
  );
}
