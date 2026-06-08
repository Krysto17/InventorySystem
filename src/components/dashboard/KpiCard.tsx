import { TrendingUp, TrendingDown } from "lucide-react";

type Props = {
  label: string;
  value: string | number;
  sub?: string;
  trend?: number | null;       // percentage; positive = up
  icon?: React.ReactNode;
};

export function KpiCard({ label, value, sub, trend, icon }: Props) {
  const hasTrend = trend != null && Number.isFinite(trend);
  const up = (trend ?? 0) >= 0;

  return (
    <div className="rounded-[var(--radius-card)] border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-start justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</span>
        {icon && <span className="text-brand-600 dark:text-brand-500">{icon}</span>}
      </div>
      <div className="mt-2 text-2xl font-bold text-zinc-900 dark:text-zinc-50">{value}</div>
      <div className="mt-1 flex items-center gap-2">
        {hasTrend && (
          <span
            className={`inline-flex items-center gap-0.5 text-xs font-medium ${
              up ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
            }`}
          >
            {up ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
            {up ? "+" : ""}
            {trend!.toFixed(1)}%
          </span>
        )}
        {sub && <span className="text-xs text-zinc-500">{sub}</span>}
      </div>
    </div>
  );
}
