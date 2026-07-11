interface PillGroupOption {
  value: string;
  label: string;
  disabled?: boolean;
  title?: string;
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
          onClick={() => !opt.disabled && onChange(opt.value)}
          disabled={opt.disabled}
          title={opt.title}
          className={`px-3 py-1.5 text-xs font-mono font-medium rounded-md transition-all duration-150 ${
            opt.disabled
              ? "text-muted/30 cursor-not-allowed line-through decoration-muted/30"
              : value === opt.value
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
