interface PillGroupOption {
  value: string;
  label: string;
}

interface PillGroupProps {
  value: string;
  options: PillGroupOption[];
  onChange: (value: string) => void;
}

export function PillGroup({ value, options, onChange }: PillGroupProps) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`px-3 py-1.5 text-xs font-mono font-medium rounded-md transition-all duration-150 ${
            value === opt.value
              ? "bg-accent/15 text-accent ring-1 ring-accent/30"
              : "text-muted hover:text-ink hover:bg-elevated"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
