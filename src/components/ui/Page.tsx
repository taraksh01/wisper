import type { ReactNode } from "react";

/**
 * Single page shell — spacing and enter animation.
 * App.tsx provides outer max-w/px (single truth for width),
 * Page provides inner vertical rhythm.
 */
export function Page({ children }: { children: ReactNode }) {
  return <div className="space-y-5">{children}</div>;
}
