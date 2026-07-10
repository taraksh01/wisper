export function ResetButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="text-[10px] font-mono text-accent/60 hover:text-accent transition-colors flex items-center gap-1"
    >
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
      Reset tab
    </button>
  );
}
