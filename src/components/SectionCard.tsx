import type { ReactNode } from "react";

interface SectionCardProps {
  title?: string;
  children: ReactNode;
  className?: string;
}

export function SectionCard({ title, children, className = "" }: SectionCardProps) {
  return (
    <section className={`bg-surface border border-stroke rounded-xl p-4 ${className}`}>
      {title && (
        <h2 className="text-[10px] font-mono text-muted tracking-[0.12em] uppercase mb-3">{title}</h2>
      )}
      {children}
    </section>
  );
}
