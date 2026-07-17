import { useState, useRef, useEffect, useCallback } from "react";
import { SectionCard } from "./SectionCard";

const UPI_ID = "taraksh01@upi";
const UPI_LINK = `upi://pay?pa=${UPI_ID}&pn=Tarak`;
const QR_URL = `https://api.qrserver.com/v1/create-qr-code/?size=500x500&margin=15&data=${encodeURIComponent(UPI_LINK)}`;

const MIN_QR = 140;
const MAX_QR = 300;
// Vertical space to leave below the QR for the caption + section padding.
const QR_VERTICAL_RESERVE = 96;

export function DonateTab() {
  const [copied, setCopied] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const [qrSize, setQrSize] = useState(MIN_QR);

  const measure = useCallback(() => {
    const card = cardRef.current;
    if (!card) return;
    const root = card.closest(".overflow-y-auto") as HTMLElement | null;
    const containerBottom = root
      ? root.getBoundingClientRect().bottom
      : window.innerHeight;
    const cardTop = card.getBoundingClientRect().top;
    const availableHeight = containerBottom - cardTop - QR_VERTICAL_RESERVE;
    // Card has p-4 (16px) on each side; QR is centered, so width is bounded by inner width.
    const availableWidth = card.clientWidth - 32;
    const size = Math.round(
      Math.min(availableWidth, Math.max(MIN_QR, availableHeight))
    );
    setQrSize(Math.max(MIN_QR, Math.min(MAX_QR, size)));
  }, []);

  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    const root = cardRef.current?.closest(".overflow-y-auto") as HTMLElement | null;
    let ro: ResizeObserver | undefined;
    if (root && "ResizeObserver" in window) {
      ro = new ResizeObserver(measure);
      ro.observe(root);
    }
    return () => {
      window.removeEventListener("resize", measure);
      ro?.disconnect();
    };
  }, [measure]);
  return (
    <div className="max-w-5xl mx-auto space-y-4 card-enter">
      <div className="flex items-center gap-2">
        <svg className="w-5 h-5 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
        </svg>
        <h1 className="text-sm font-semibold text-ink tracking-tight">Donate</h1>
      </div>

      <SectionCard className="card-enter text-center">
        <p className="text-xs text-muted leading-relaxed">
          If you find this app useful, consider supporting its development.
        </p>
      </SectionCard>

      <SectionCard title="Support" className="card-enter">
        <div className="space-y-2">
          <a
            href="https://github.com/sponsors/taraksh01"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-elevated/30 hover:bg-elevated/60 ring-1 ring-stroke hover:ring-accent/30 transition-all"
          >
            <svg className="w-5 h-5 shrink-0 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-mono text-ink">GitHub Sponsors</div>
              <div className="text-[10px] font-mono text-muted">Support via GitHub</div>
            </div>
            <svg className="w-3.5 h-3.5 shrink-0 text-muted/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </a>

          <a
            href="https://www.buymeacoffee.com/taraksh01"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-elevated/30 hover:bg-elevated/60 ring-1 ring-stroke hover:ring-accent/30 transition-all"
          >
            <svg className="w-5 h-5 shrink-0 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8h1a4 4 0 0 1 0 8h-1" />
              <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z" />
              <line x1="6" y1="1" x2="6" y2="4" />
              <line x1="10" y1="1" x2="10" y2="4" />
              <line x1="14" y1="1" x2="14" y2="4" />
            </svg>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-mono text-ink">Buy Me a Coffee</div>
              <div className="text-[10px] font-mono text-muted">One-time tip</div>
            </div>
            <svg className="w-3.5 h-3.5 shrink-0 text-muted/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </a>
        </div>
      </SectionCard>

      <SectionCard className="card-enter" cardRef={cardRef}>
        <div className="mb-3">
          <h2 className="text-[10px] font-mono text-muted tracking-[0.12em] uppercase">UPI</h2>
        </div>
        <div className="flex flex-col items-center gap-3 py-2">
          <button
            onClick={() => {
              navigator.clipboard.writeText(UPI_ID);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            className="relative cursor-pointer"
          >
            <img
              src={QR_URL}
              alt="UPI QR Code"
              style={{ width: qrSize, height: qrSize }}
              className="rounded-lg ring-1 ring-stroke"
            />
          </button>
          <button
            onClick={() => {
              navigator.clipboard.writeText(UPI_ID);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md ring-1 transition-all text-xs font-mono cursor-pointer ${
              copied
                ? "bg-ready/15 text-ready ring-ready/40"
                : "bg-elevated/30 hover:bg-elevated/60 text-ink ring-stroke hover:ring-accent/30"
            }`}
          >
            {copied ? "Copied!" : UPI_ID}
            {copied ? (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
              </svg>
            )}
          </button>
        </div>
      </SectionCard>
    </div>
  );
}
