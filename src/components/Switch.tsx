interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
}

export function Switch({ checked, onChange, disabled = false, label }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`transition-transform duration-150 active:scale-[0.98] relative inline-flex h-[22px] w-[40px] shrink-0 items-center rounded-full border outline-none transition-colors duration-150 ${
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
      } ${checked ? "bg-accent border-accent shadow-[0_1px_4px_color-mix(in_srgb,var(--color-accent)_35%,transparent)]" : "bg-elevated border-stroke"}`}
    >
      <span
        className={`inline-block h-[16px] w-[16px] transform rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.25)] ring-1 ring-black/5 transition-transform duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${
          checked ? "translate-x-[20px]" : "translate-x-[2px]"
        }`}
      />
    </button>
  );
}
