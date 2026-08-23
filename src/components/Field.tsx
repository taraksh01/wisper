import { useState, useId } from "react";
import { IconEye, IconEyeOff } from "./ui/icons";
import { Input } from "./ui/Input";

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
  const id = useId();
  const inputId = `field-${id}`;
  return (
    <div>
      <label htmlFor={inputId} className="label-soft block mb-1">{label}</label>
      <div className="relative">
        <Input
          id={inputId}
          type={secret && !show ? "password" : "text"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          variant="surface"
          className="pr-10"
          placeholder={placeholder}
          autoComplete={secret ? "new-password" : undefined}
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
