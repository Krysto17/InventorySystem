// Chip: monospace status token, ledger-stamped. Variants map to the
// industrial-ledger semantics (approve green / reject red / pending ochre).
// Legacy variant names (green/yellow/red/blue/purple) are kept so existing
// call sites keep working.
const VARIANTS = {
  default:  "bg-[#E2E6E9] text-ink-2 dark:bg-zinc-800 dark:text-zinc-300",
  approved: "bg-approve-soft text-approve",
  paid:     "bg-approve text-white",
  green:    "bg-approve-soft text-approve",
  yellow:   "bg-pending-soft text-pending",
  review:   "bg-pending-soft text-pending",
  red:      "bg-reject-soft text-reject",
  blue:     "bg-[#E2E6E9] text-ink-2 dark:bg-zinc-800 dark:text-zinc-300",
  purple:   "bg-ore-soft text-ore",
  ore:      "bg-ore-soft text-ore",
} as const;

type Variant = keyof typeof VARIANTS;

export function Badge({
  children,
  variant = "default",
}: {
  children: React.ReactNode;
  variant?: Variant;
}) {
  return (
    <span
      className={`mono inline-block rounded-[2px] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.03em] ${VARIANTS[variant]}`}
    >
      {children}
    </span>
  );
}

// Maps a visit state to a chip colour.
export function stateVariant(state: string): Variant {
  if (state === "stocked") return "paid";
  if (state === "exited") return "default";
  if (state === "in_accounting" || state === "awaiting_stock_intake") return "approved";
  if (state === "pricing") return "ore";
  if (state === "in_qc") return "review";
  if (state === "in_processing" || state === "in_receiving") return "yellow";
  return "default";
}
