import { useState, useRef, useEffect, useLayoutEffect, useCallback, useId } from "react";
import { createPortal } from "react-dom";
import { IconChevronDown } from "./ui/icons";

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
  const autoId = useId();
  const buttonId = label ? `select-${label.replace(/\s+/g, "-").toLowerCase()}` : `select-${autoId}`;
  const listId = `select-list-${buttonId}`;

  const selected = options.find((o) => o.value === value);
  const enabledOptions = options;
  const activeIndexRef = useRef(Math.max(0, enabledOptions.findIndex((o) => o.value === value)));

  useEffect(() => {
    activeIndexRef.current = Math.max(0, enabledOptions.findIndex((o) => o.value === value));
  }, [value, enabledOptions]);

  const moveActive = useCallback((dir: 1 | -1) => {
    if (enabledOptions.length === 0) return;
    const next = (activeIndexRef.current + dir + enabledOptions.length) % enabledOptions.length;
    activeIndexRef.current = next;
    const list = document.getElementById(listId);
    list?.querySelectorAll<HTMLElement>("[data-opt]")[next]?.scrollIntoView({ block: "nearest" });
    setForceRender((r) => r + 1);
  }, [enabledOptions.length, listId]);

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
          id={buttonId}
          ref={buttonRef}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
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
          className="w-full bg-surface border border-stroke rounded-xl px-3.5 py-2.5 text-xs font-medium text-ink text-left outline-none focus:border-accent/40 focus:ring-2 focus:ring-accent/15 shadow-[inset_0_1px_0_var(--color-stroke-soft)] transition-[border-color,box-shadow] duration-150 cursor-pointer flex items-center justify-between gap-2"
        >
          <span className="truncate">{selected?.label ?? value}</span>
          <span className="shrink-0 w-6 h-6 grid place-items-center rounded-full bg-elevated border border-stroke">
            <IconChevronDown className={`w-3 h-3 text-muted transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
          </span>
        </button>

        {open && pos && createPortal(
          <div
            id={listId}
            role="listbox"
            className="fixed z-[9999] bg-surface border border-stroke rounded-xl shadow-[0_8px_24px_rgba(0,0,0,0.16)] overflow-y-auto custom-scrollbar p-1"
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
                  className={`w-full text-left px-3 py-2 text-xs font-medium rounded-lg transition-colors cursor-pointer truncate ${
                    value === opt.value
                      ? "bg-accent/10 text-accent shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-accent)_20%,transparent)]"
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
