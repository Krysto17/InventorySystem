export function formatNaira(amount: number | null | undefined): string {
  if (amount == null) return "—";
  return new Intl.NumberFormat("en-NG", {
    style: "currency", currency: "NGN", maximumFractionDigits: 2,
  }).format(amount);
}

export function formatWeight(kg: number | null | undefined): string {
  if (kg == null) return "—";
  return `${new Intl.NumberFormat("en-NG", { maximumFractionDigits: 3 }).format(kg)} kg`;
}

export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-NG", {
    dateStyle: "medium", timeStyle: "short",
  });
}
