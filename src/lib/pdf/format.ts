// PDF-safe formatting helpers (no Intl dependency issues in Node PDF context)

export function formatTs(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-NG", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export function formatNgn(amount: number | null | undefined): string {
  if (amount == null) return "—";
  return `₦${Number(amount).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`;
}

export function formatKg(weight: number | null | undefined): string {
  if (weight == null) return "—";
  return `${Number(weight).toFixed(3)} kg`;
}
