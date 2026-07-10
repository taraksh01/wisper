import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";

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
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className={className}>
      {label && <label className="text-[11px] font-mono text-muted block mb-1 tracking-wider">{label}</label>}
      <div className="relative w-full" ref={containerRef}>
        <button
          ref={buttonRef}
          onClick={() => setOpen((p) => !p)}
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

        {open && createPortal(
          <div
            className="fixed z-[9999] bg-surface border border-stroke rounded-md shadow-lg max-h-48 overflow-y-auto custom-scrollbar"
            ref={(el) => {
              if (!el || !buttonRef.current) return;
              const r = buttonRef.current.getBoundingClientRect();
              el.style.top = `${r.bottom + 4}px`;
              el.style.left = `${r.left}px`;
              el.style.width = `${r.width}px`;
            }}
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
                className={`w-full text-left px-2.5 py-1.5 text-xs font-mono transition-colors cursor-pointer truncate ${
                  value === opt.value
                    ? "bg-accent/20 text-accent"
                    : "text-muted hover:bg-elevated hover:text-ink"
                }`}
                title={opt.label}
              >
                {opt.label}
              </button>
            ))}
          </div>,
          document.body
        )}
      </div>
    </div>
  );
}
