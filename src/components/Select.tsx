import { useState, useRef, useEffect, useLayoutEffect, useCallback, useId } from "react";
import { createPortal } from "react-dom";
import { IconChevronDown } from "./ui/icons";
import { Input } from "./ui/Input";

export function Select({
  value,
  options,
  onChange,
  label,
  className,
  searchable = false,
  compact = false,
  placeholder,
}: {
  value: string;
  options: { value: string; label: string; disabled?: boolean; title?: string }[];
  onChange: (v: string) => void;
  label?: string;
  className?: string;
  /** Show a search input inside the dropdown (for long lists) */
  searchable?: boolean;
  compact?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
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
  const searchRef = useRef<HTMLInputElement>(null);
  const autoId = useId();
  const buttonId = label ? `select-${label.replace(/\s+/g, "-").toLowerCase()}` : `select-${autoId}`;
  const listId = `select-list-${buttonId}`;

  const selected = options.find((o) => o.value === value);
  const enabledOptions = options;

  const visibleOptions = searchable && query
    ? enabledOptions.filter(
        (o) =>
          o.label.toLowerCase().includes(query.toLowerCase()) ||
          o.value.toLowerCase().includes(query.toLowerCase())
      )
    : enabledOptions;

  const activeIndexRef = useRef(Math.max(0, visibleOptions.findIndex((o) => o.value === value)));

  useEffect(() => {
    let idx = visibleOptions.findIndex((o) => o.value === value);
    if (idx === -1 || visibleOptions[idx]?.disabled) {
      idx = visibleOptions.findIndex((o) => !o.disabled);
      if (idx === -1) idx = 0;
    }
    activeIndexRef.current = Math.max(0, idx);
  }, [value, visibleOptions]);

  useEffect(() => {
    if (activeIndexRef.current >= visibleOptions.length) {
      activeIndexRef.current = Math.max(0, visibleOptions.length - 1);
      if (visibleOptions[activeIndexRef.current]?.disabled) {
        const first = visibleOptions.findIndex((o) => !o.disabled);
        if (first !== -1) activeIndexRef.current = first;
      }
      setForceRender((r) => r + 1);
    } else if (visibleOptions[activeIndexRef.current]?.disabled) {
      const first = visibleOptions.findIndex((o) => !o.disabled);
      if (first !== -1) {
        activeIndexRef.current = first;
        setForceRender((r) => r + 1);
      }
    }
  }, [visibleOptions.length]);

  const moveActive = useCallback((dir: 1 | -1) => {
    if (visibleOptions.length === 0) return;
    let next = activeIndexRef.current;
    for (let i = 0; i < visibleOptions.length; i++) {
      next = (next + dir + visibleOptions.length) % visibleOptions.length;
      if (!visibleOptions[next]?.disabled) break;
    }
    if (visibleOptions[next]?.disabled) return;
    activeIndexRef.current = next;
    const list = document.getElementById(listId);
    list?.querySelectorAll<HTMLElement>("[data-opt]")[next]?.scrollIntoView({ block: "nearest" });
    setForceRender((r) => r + 1);
  }, [visibleOptions, listId]);

  const updatePos = useCallback(() => {
    if (!buttonRef.current) return;
    const r = buttonRef.current.getBoundingClientRect();
    const gap = 4;
    const fixedHeight = 220;
    const spaceBelow = window.innerHeight - r.bottom - 8;
    const spaceAbove = r.top - 8;
    const placeTop = spaceBelow < fixedHeight && spaceAbove > spaceBelow;
    const width = r.width;
    let left = r.left;
    if (left + width > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - width - 8);
    }
    setPos({
      top: placeTop ? r.top - gap : r.bottom + gap,
      left,
      width,
      maxHeight: fixedHeight,
      placement: placeTop ? "top" : "bottom",
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    const esc = (typeof CSS !== "undefined" && (CSS as any).escape) ? (CSS as any).escape(listId) : listId.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        !(target instanceof Element && target.closest(`#${esc}`))
      ) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler as unknown as EventListener);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler as unknown as EventListener);
    };
  }, [open, listId]);

  useLayoutEffect(() => {
    if (!open) return;
    updatePos();
    if (searchable) {
      setTimeout(() => searchRef.current?.focus(), 0);
    }
    window.addEventListener("scroll", updatePos, true);
    window.addEventListener("resize", updatePos);
    return () => {
      window.removeEventListener("scroll", updatePos, true);
      window.removeEventListener("resize", updatePos);
    };
  }, [open, updatePos, searchable]);

  useEffect(() => {
    if (open) {
      setQuery("");
      let idx = visibleOptions.findIndex((o) => o.value === value);
      if (idx === -1 || visibleOptions[idx]?.disabled) {
        idx = visibleOptions.findIndex((o) => !o.disabled);
        if (idx === -1) idx = 0;
      }
      activeIndexRef.current = Math.max(0, idx);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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
          aria-activedescendant={open && visibleOptions[activeIndexRef.current] ? `${listId}-opt-${activeIndexRef.current}` : undefined}
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
              const opt = visibleOptions[activeIndexRef.current];
              if (opt && !opt.disabled) {
                onChange(opt.value);
                setOpen(false);
                setQuery("");
              }
            } else if (e.key === "Escape") {
              setOpen(false);
              setQuery("");
            }
          }}
          className={`w-full bg-surface border border-stroke rounded-xl text-xs font-medium text-ink text-left outline-none focus:border-accent/40 focus:ring-2 focus:ring-accent/15 shadow-[inset_0_1px_0_var(--color-stroke-soft)] transition-[border-color,box-shadow] duration-150 cursor-pointer flex items-center justify-between gap-2 ${compact ? "px-3 py-2 text-[11px]" : "px-3.5 py-2.5"}`}
        >
          <span className={`truncate ${!selected && placeholder ? "text-muted" : ""}`}>{selected?.label ?? placeholder ?? value}</span>
          <span className="shrink-0 w-6 h-6 grid place-items-center rounded-full bg-elevated border border-stroke">
            <IconChevronDown className={`w-3 h-3 text-muted transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
          </span>
        </button>

        {open && pos && createPortal(
          <div
            id={listId}
            role="listbox"
            className="fixed z-[9999] bg-surface border border-stroke rounded-xl shadow-[0_8px_24px_rgba(0,0,0,0.16)] flex flex-col overflow-hidden p-1"
            style={{
              left: pos.left,
              width: pos.width,
              maxHeight: pos.maxHeight,
              ...(pos.placement === "top"
                ? { bottom: window.innerHeight - pos.top }
                : { top: pos.top }),
            }}
          >
            {searchable && (
              <div className="shrink-0 bg-surface p-1 pb-2 border-b border-stroke/60">
                <Input
                  ref={searchRef}
                  value={query}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                    setQuery(e.target.value);
                    activeIndexRef.current = 0;
                  }}
                  onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      moveActive(1);
                    } else if (e.key === "ArrowUp") {
                      e.preventDefault();
                      moveActive(-1);
                    } else if (e.key === "Enter") {
                      e.preventDefault();
                      const opt = visibleOptions[activeIndexRef.current];
                      if (opt && !opt.disabled) {
                        onChange(opt.value);
                        setOpen(false);
                        setQuery("");
                      }
                    } else if (e.key === "Escape") {
                      setOpen(false);
                      setQuery("");
                    }
                  }}
                  placeholder="Search languages…"
                  variant="surface"
                  className="w-full"
                />
              </div>
            )}
            <div
              className="flex-1 min-h-0 overflow-y-auto custom-scrollbar"
              onWheel={(e) => {
                const el = e.currentTarget;
                const atTop = el.scrollTop === 0;
                const atBottom = el.scrollHeight - el.scrollTop <= el.clientHeight;
                if ((atTop && e.deltaY < 0) || (atBottom && e.deltaY > 0)) return;
                e.stopPropagation();
              }}
            >
            {visibleOptions.map((opt, i) => {
              const isActive = i === activeIndexRef.current && open;
              const isDisabled = !!opt.disabled;
              return (
                <button
                  key={opt.value}
                  id={`${listId}-opt-${i}`}
                  data-opt
                  role="option"
                  aria-selected={value === opt.value}
                  aria-disabled={isDisabled || undefined}
                  disabled={isDisabled}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    if (isDisabled) return;
                    onChange(opt.value);
                    setOpen(false);
                    setQuery("");
                  }}
                  onMouseEnter={() => { if (!isDisabled) activeIndexRef.current = i; }}
                  className={`w-full text-left px-3 py-2 text-xs font-medium rounded-lg transition-colors truncate ${
                    isDisabled
                      ? "opacity-40 cursor-not-allowed text-muted"
                      : value === opt.value
                      ? "bg-accent/10 text-accent shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-accent)_20%,transparent)] cursor-pointer"
                      : isActive
                      ? "bg-elevated text-ink cursor-pointer"
                      : "text-muted hover:bg-elevated hover:text-ink cursor-pointer"
                  }`}
                  title={opt.title ?? opt.label}
                >
                  {opt.label}
                </button>
              );
            })}
            {visibleOptions.length === 0 && (
              <p className="px-3 py-4 text-center text-xs text-muted">No matches</p>
            )}
            </div>
          </div>,
          document.body
        )}
      </div>
    </div>
  );
}
