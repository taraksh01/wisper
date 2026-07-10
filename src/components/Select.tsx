import { useState } from "react";

export function Select({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  const selected = options.find((o) => o.value === value);

  return (
    <div className={className}>
      {label && <label className="text-[11px] font-mono text-muted block mb-1 tracking-wider">{label}</label>}
      <div className="relative w-full max-w-60">
        <button
          onClick={() => setOpen(!open)}
          onBlur={() => setOpen(false)}
          className="w-full bg-elevated rounded-md px-2.5 py-1.5 text-xs font-mono text-ink text-left outline-none ring-1 ring-stroke focus:ring-accent/40 transition-all cursor-pointer flex items-center justify-between gap-2"
        >
        <span>{selected?.label ?? value}</span>
        <svg
          className={`w-3 h-3 text-muted transition-transform duration-150 ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute z-10 mt-1 w-full bg-surface border border-stroke rounded-md shadow-lg max-h-48 overflow-y-auto custom-scrollbar"
          onWheel={(e) => {
            const el = e.currentTarget;
            const atTop = el.scrollTop === 0;
            const atBottom = el.scrollHeight - el.scrollTop <= el.clientHeight;
            if ((atTop && e.deltaY < 0) || (atBottom && e.deltaY > 0)) return;
            e.stopPropagation();
          }}
        >
          {options.map((opt) => (
            <button
              key={opt.value}
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(opt.value);
                setOpen(false);
              }}
              className={`w-full text-left px-2.5 py-1.5 text-xs font-mono transition-colors cursor-pointer ${
                value === opt.value
                  ? "bg-accent/20 text-accent"
                  : "text-muted hover:bg-elevated hover:text-ink"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
      </div>
    </div>
  );
}
