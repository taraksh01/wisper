import type { ReactNode } from "react";

interface SectionCardProps {
  title?: string;
  children: ReactNode;
  className?: string;
  cardRef?: React.Ref<HTMLElement>;
}

export function SectionCard({ title, children, className = "", cardRef }: SectionCardProps) {
  return (
    <section ref={cardRef} className={`bg-surface border border-stroke rounded-[var(--radius-card)] p-5 shadow-[var(--shadow-card)] relative overflow-hidden before:absolute before:inset-0 before:rounded-[inherit] before:bg-[linear-gradient(to_bottom,var(--color-stroke-soft),transparent_40%)] before:pointer-events-none before:opacity-60 ${className}`}>
      {title && (
        <h2 className="label-soft mb-4">{title}</h2>
      )}
      {children}
    </section>
  );
}
