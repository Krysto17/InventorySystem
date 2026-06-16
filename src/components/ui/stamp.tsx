import { type ReactNode } from "react";

// Monospace identifier on graphite — batch / visit / supplier codes.
export function Stamp({ children }: { children: ReactNode }) {
  return <span className="stamp">{children}</span>;
}

// Ochre uppercase kicker shown above a page title.
export function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="eyebrow">{children}</div>;
}

// Price / figure a viewer's role is not cleared to see (RLS already hides the
// underlying data; this is the visible "redacted" treatment).
export function Restricted() {
  return <span className="mono text-[11px] tracking-[0.1em] text-[#9AA3A1]">RESTRICTED</span>;
}
