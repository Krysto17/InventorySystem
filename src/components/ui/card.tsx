import { type ReactNode } from "react";

// Panel: hard 1.5px border, square-ish corners — a sheet in the ledger.
export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded border-[1.5px] border-line bg-panel ${className}`}>
      {children}
    </div>
  );
}

export function CardHeader({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`border-b-[1.5px] border-line px-4 py-3 text-ink ${className}`}>
      {children}
    </div>
  );
}

export function CardContent({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`px-4 py-3 text-ink-2 ${className}`}>{children}</div>
  );
}
