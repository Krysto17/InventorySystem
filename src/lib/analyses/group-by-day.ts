// Shared per-day grouping for the analyses dashboards (mirrors the supply
// pipeline's daily records).
export const dayKey = (iso: string) => iso.slice(0, 10);
export const dayLabel = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "short", year: "numeric" });

// Group rows (already sorted) into contiguous day buckets, newest day first.
export function groupByDay<T extends { date: string }>(rows: T[]): { key: string; rows: T[] }[] {
  const byDay = [...rows].sort((a, b) => b.date.localeCompare(a.date));
  const out: { key: string; rows: T[] }[] = [];
  for (const r of byDay) {
    const k = dayKey(r.date);
    const last = out[out.length - 1];
    if (last && last.key === k) last.rows.push(r);
    else out.push({ key: k, rows: [r] });
  }
  return out;
}
