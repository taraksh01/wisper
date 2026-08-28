import { useState } from "react";
import { createPortal } from "react-dom";
import { useEffect } from "react";
import { Field } from "./Field";
import { Button } from "./ui/Button";
import { IconCloseSmall } from "./ui/icons";

interface CostEstimatorModalProps {
  onClose: () => void;
}

const DEFAULTS = {
  inputPrice: 0.1,
  outputPrice: 0.2,
  requestsPerDay: 2000,
  wordsPerRequest: 25,
};

/** Rough constants used for the estimate (displayed in the modal) */
const TOKENS_PER_WORD = 1.35;
const PROMPT_OVERHEAD_TOKENS = 500; // system prompt + dictionary hint
const DAYS_PER_MONTH = 30;

export function CostEstimatorModal({ onClose }: CostEstimatorModalProps) {
  const [inputPrice, setInputPrice] = useState(DEFAULTS.inputPrice);
  const [outputPrice, setOutputPrice] = useState(DEFAULTS.outputPrice);
  const [requestsPerDay, setRequestsPerDay] = useState(DEFAULTS.requestsPerDay);
  const [wordsPerRequest, setWordsPerRequest] = useState(DEFAULTS.wordsPerRequest);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  const num = (v: string, fallback: number) => {
    const n = parseFloat(v);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };

  const inTokPerReq = Math.round(wordsPerRequest * TOKENS_PER_WORD + PROMPT_OVERHEAD_TOKENS);
  const outTokPerReq = Math.round(wordsPerRequest * TOKENS_PER_WORD);

  const dailyInTokens = inTokPerReq * requestsPerDay;
  const dailyOutTokens = outTokPerReq * requestsPerDay;

  const monthlyInCost = (dailyInTokens * DAYS_PER_MONTH) / 1_000_000 * inputPrice;
  const monthlyOutCost = (dailyOutTokens * DAYS_PER_MONTH) / 1_000_000 * outputPrice;
  const monthlyTotal = monthlyInCost + monthlyOutCost;
  const dailyTotal = dailyInTokens / 1_000_000 * inputPrice + dailyOutTokens / 1_000_000 * outputPrice;
  const perRequestCost = requestsPerDay > 0 ? dailyTotal / requestsPerDay : 0;

  const fmtUsd = (n: number) => `$${n < 0.01 && n > 0 ? n.toFixed(4) : n.toFixed(2)}`;
  const fmtNum = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose} role="dialog" aria-modal="true">
      <div className="bg-surface border border-stroke rounded-xl p-5 max-w-lg w-full mx-4 shadow-2xl max-h-[90vh] overflow-y-auto custom-scrollbar" onClick={(e) => e.stopPropagation()} role="document">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold font-mono text-ink">Estimated monthly AI cost</h3>
          <Button
            variant="ghost"
            onClick={onClose}
            className="w-6 h-6 rounded-full text-muted hover:text-ink hover:bg-elevated"
            aria-label="Close"
          >
            <IconCloseSmall className="w-3 h-3" />
          </Button>
        </div>

        <p className="text-[11px] text-muted leading-relaxed mb-4">
          Estimate what Wisper's AI refinement would cost with your provider. Adjust the assumptions to match your plan and usage.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Input cost ($ / 1M tokens)" value={String(inputPrice)} onChange={(v) => setInputPrice(num(v, 0))} />
          <Field label="Output cost ($ / 1M tokens)" value={String(outputPrice)} onChange={(v) => setOutputPrice(num(v, 0))} />
          <Field label="Requests per day" type="number" value={String(requestsPerDay)} onChange={(v) => setRequestsPerDay(Math.round(num(v, 0)))} />
          <Field label="Avg words per request" type="number" value={String(wordsPerRequest)} onChange={(v) => setWordsPerRequest(num(v, 1))} />
        </div>

        <Button
          variant="ghost"
          onClick={() => { setInputPrice(DEFAULTS.inputPrice); setOutputPrice(DEFAULTS.outputPrice); setRequestsPerDay(DEFAULTS.requestsPerDay); setWordsPerRequest(DEFAULTS.wordsPerRequest); }}
          className="text-[10px] font-mono text-accent hover:text-ink mt-2"
        >
          Reset to defaults
        </Button>

        <div className="mt-4 rounded-lg bg-elevated/40 border border-stroke p-3 space-y-1.5">
          <div className="flex justify-between text-[11px] font-mono">
            <span className="text-muted">Input tokens / request</span>
            <span className="text-ink">{fmtNum(inTokPerReq)}</span>
          </div>
          <div className="flex justify-between text-[11px] font-mono">
            <span className="text-muted">Output tokens / request</span>
            <span className="text-ink">{fmtNum(outTokPerReq)}</span>
          </div>
          <div className="flex justify-between text-[11px] font-mono">
            <span className="text-muted">Tokens / month</span>
            <span className="text-ink">{fmtNum((dailyInTokens + dailyOutTokens) * DAYS_PER_MONTH)}</span>
          </div>
        </div>

        <div className="mt-3 rounded-lg bg-accent/10 border border-accent/20 p-4">
          <div className="text-center">
            <div className="text-2xl font-bold font-mono text-accent">{fmtUsd(monthlyTotal)}</div>
            <div className="text-[10px] font-mono text-muted mt-0.5">estimated per month ({DAYS_PER_MONTH} days)</div>
          </div>
          <div className="mt-3 space-y-1">
            <div className="flex justify-between text-[11px] font-mono">
              <span className="text-muted">Input cost</span>
              <span className="text-ink">{fmtUsd(monthlyInCost)}</span>
            </div>
            <div className="flex justify-between text-[11px] font-mono">
              <span className="text-muted">Output cost</span>
              <span className="text-ink">{fmtUsd(monthlyOutCost)}</span>
            </div>
            <div className="flex justify-between text-[11px] font-mono pt-1 border-t border-stroke/60">
              <span className="text-muted">Per day</span>
              <span className="text-ink">{fmtUsd(dailyTotal)}</span>
            </div>
            <div className="flex justify-between text-[11px] font-mono">
              <span className="text-muted">Per request</span>
              <span className="text-ink">{fmtUsd(perRequestCost)}</span>
            </div>
          </div>
        </div>

        <p className="text-[10px] font-mono text-muted/50 leading-relaxed mt-3">
          Assumes ~{TOKENS_PER_WORD} tokens per word plus ~{PROMPT_OVERHEAD_TOKENS} tokens of fixed prompt instructions. Actual costs depend on your provider's metering.
        </p>
      </div>
    </div>,
    document.body
  );
}
