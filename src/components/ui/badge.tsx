const VARIANTS = {
  default:  "bg-gray-100 text-gray-700",
  green:    "bg-green-100 text-green-800",
  yellow:   "bg-yellow-100 text-yellow-800",
  red:      "bg-red-100 text-red-800",
  blue:     "bg-blue-100 text-blue-800",
  purple:   "bg-purple-100 text-purple-800",
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
