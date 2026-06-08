const VARIANTS = {
  default:  "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  green:    "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  yellow:   "bg-yellow-100 text-yellow-800 dark:bg-yellow-500/15 dark:text-yellow-300",
  red:      "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",
  blue:     "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300",
  purple:   "bg-purple-100 text-purple-800 dark:bg-purple-500/15 dark:text-purple-300",
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
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${VARIANTS[variant]}`}>
      {children}
    </span>
  );
}

export function stateVariant(state: string): Variant {
  if (state === "stocked" || state === "exited") return "default";
  if (state === "in_accounting" || state === "awaiting_stock_intake") return "blue";
  if (state === "pricing") return "purple";
  if (state === "in_processing") return "yellow";
  return "default";
}
