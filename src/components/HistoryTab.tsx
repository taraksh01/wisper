import { HistoryEntry, AppSettings } from "../types";

interface HistoryTabProps {
  history: HistoryEntry[];
  stats: [number, number, number];
  settings: AppSettings;
  onRefresh: () => void;
}

export function HistoryTab({ history, stats, settings, onRefresh }: HistoryTabProps) {
  return (
    <div className="space-y-3 panel-enter">
      <section className="panel-enter">
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "Dictations", value: stats[0] },
            { label: "Words", value: stats[1] },
            { label: "Avg Words", value: stats[2].toFixed(1) },
          ].map((s) => (
            <div key={s.label} className="bg-elevated/30 rounded-lg px-3 py-2.5 text-center">
              <div className="text-lg font-bold font-mono text-accent tabular-nums">{s.value}</div>
              <div className="text-[10px] font-mono text-muted mt-0.5 tracking-wider uppercase">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="panel-enter">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs font-mono text-muted tracking-wider uppercase">Recent</div>
          <div className="flex items-center gap-2">
            <button
              onClick={onRefresh}
              className="text-[11px] font-mono text-accent hover:text-accent-dim transition-colors"
            >
              Refresh
            </button>
          </div>
        </div>
        {history.length === 0 ? (
          <p className="text-xs text-muted">No history yet. Press {settings.hotkey} to dictate.</p>
        ) : (
          <div className="space-y-1.5 max-h-72 overflow-y-auto custom-scrollbar">
            {history.map((entry) => (
              <div
                key={entry.id}
                className="bg-elevated/30 rounded-md px-2.5 py-2 hover:bg-elevated/60 transition-colors cursor-pointer"
                onClick={() => navigator.clipboard.writeText(entry.formatted_text || entry.raw_text)}
              >
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-[10px] font-mono text-muted">{entry.created_at}</span>
                  <span className="text-[10px] font-mono text-muted tabular-nums">{entry.word_count}</span>
                </div>
                <p className="text-xs text-ink leading-relaxed line-clamp-2" title={entry.formatted_text || entry.raw_text}>
                  {entry.formatted_text || entry.raw_text}
                </p>
                {entry.agent_name && (
                  <span className="text-[10px] text-accent/70 mt-0.5 block">{entry.agent_name}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
