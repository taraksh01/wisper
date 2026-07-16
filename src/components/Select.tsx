import { useState, useRef, useEffect, useLayoutEffect, useCallback } from "react";
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
  const [, setForceRender] = useState(0);
  const [pos, setPos] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
    placement: "bottom" | "top";
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const selected = options.find((o) => o.value === value);
  const enabledOptions = options;
  const activeIndexRef = useRef(Math.max(0, enabledOptions.findIndex((o) => o.value === value)));

  const moveActive = useCallback((dir: 1 | -1) => {
    if (enabledOptions.length === 0) return;
    const next = (activeIndexRef.current + dir + enabledOptions.length) % enabledOptions.length;
    activeIndexRef.current = next;
    const list = document.getElementById(`select-list-${buttonRef.current?.id ?? ""}`);
    list?.querySelectorAll<HTMLElement>("[data-opt]")[next]?.scrollIntoView({ block: "nearest" });
    setForceRender((r) => r + 1);
  }, [enabledOptions.length]);

  const updatePos = useCallback(() => {
    if (!buttonRef.current) return;
    const r = buttonRef.current.getBoundingClientRect();
    const margin = 8;
    const gap = 4;
    const spaceBelow = window.innerHeight - r.bottom - margin;
    const spaceAbove = r.top - margin;
    // Prefer opening downward; flip up only when there's clearly more room above.
    const placeTop = spaceBelow < 160 && spaceAbove > spaceBelow;
    const maxHeight = Math.max(96, (placeTop ? spaceAbove : spaceBelow) - gap);
    setPos({
      top: placeTop ? r.top - gap : r.bottom + gap,
      left: r.left,
      width: r.width,
      maxHeight,
      placement: placeTop ? "top" : "bottom",
    });
  }, []);

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

  useLayoutEffect(() => {
    if (!open) return;
    updatePos();
    // Reposition while open: scroll (capture catches nested scroll containers) and resize.
    window.addEventListener("scroll", updatePos, true);
    window.addEventListener("resize", updatePos);
    return () => {
      window.removeEventListener("scroll", updatePos, true);
      window.removeEventListener("resize", updatePos);
    };
  }, [open, updatePos]);

  return (
    <div className={className}>
      {label && <label className="label-soft block mb-1">{label}</label>}
      <div className="relative w-full" ref={containerRef}>
        <button
          id={label ? `select-${label.replace(/\s+/g, "-").toLowerCase()}` : undefined}
          ref={buttonRef}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((p) => !p)}
          onKeyDown={(e) => {
            if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter")) {
              e.preventDefault();
              setOpen(true);
            } else if (open && e.key === "ArrowDown") {
              e.preventDefault();
              moveActive(1);
            } else if (open && e.key === "ArrowUp") {
              e.preventDefault();
              moveActive(-1);
            } else if (open && e.key === "Enter") {
              e.preventDefault();
              onChange(enabledOptions[activeIndexRef.current].value);
              setOpen(false);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          className="w-full bg-elevated rounded-md px-2.5 py-1.5 text-xs font-mono text-ink text-left outline-none ring-1 ring-stroke focus:ring-accent/40 transition-all cursor-pointer flex items-center justify-between gap-2"
        >
          <span className="truncate">{selected?.label ?? value}</span>
          <svg
            className={`shrink-0 w-3 h-3 text-muted transition-transform duration-150 ${open ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {open && pos && createPortal(
          <div
            id={buttonRef.current?.id ? `select-list-${buttonRef.current.id}` : undefined}
            role="listbox"
            className="fixed z-[9999] bg-surface border border-stroke rounded-md shadow-lg overflow-y-auto custom-scrollbar py-1"
            style={{
              left: pos.left,
              width: pos.width,
              maxHeight: pos.maxHeight,
              ...(pos.placement === "top"
                ? { bottom: window.innerHeight - pos.top }
                : { top: pos.top }),
            }}
            onWheel={(e) => {
              const el = e.currentTarget;
              const atTop = el.scrollTop === 0;
              const atBottom = el.scrollHeight - el.scrollTop <= el.clientHeight;
              if ((atTop && e.deltaY < 0) || (atBottom && e.deltaY > 0)) return;
              e.stopPropagation();
            }}
          >
            {options.map((opt, i) => {
              const isActive = i === activeIndexRef.current && open;
              return (
                <button
                  key={opt.value}
                  data-opt
                  role="option"
                  aria-selected={value === opt.value}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onChange(opt.value);
                    setOpen(false);
                  }}
                  onMouseEnter={() => { activeIndexRef.current = i; }}
                  className={`w-full text-left px-2.5 py-1.5 text-xs font-mono transition-colors cursor-pointer truncate ${
                    value === opt.value
                      ? "bg-accent text-white"
                      : isActive
                      ? "bg-elevated text-ink"
                      : "text-muted hover:bg-elevated hover:text-ink"
                  }`}
                  title={opt.label}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>,
          document.body
        )}
      </div>
    </div>
  );
}
