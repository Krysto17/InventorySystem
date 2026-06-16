import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { formatWeight, formatTimestamp } from "@/lib/visits/format";

export type ActivityItem = {
  id: string;
  actor: string | null;
  item: string;
  grade: string | null;
  weight: number;
  direction: "in" | "out";
  reason: string;
  at: string;
};

export function ActivityFeed({ items }: { items: ActivityItem[] }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="border-b border-zinc-200 p-3 dark:border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Recent stock activity</h2>
      </div>
      {items.length === 0 ? (
        <p className="p-6 text-center text-sm text-zinc-500">No stock movements yet.</p>
      ) : (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
          {items.map((it) => {
            const inbound = it.direction === "in";
            return (
              <li key={it.id} className="flex items-center gap-3 px-4 py-3">
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                    inbound
                      ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400"
                      : "bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-400"
                  }`}
                >
                  {inbound ? <ArrowDownLeft size={15} /> : <ArrowUpRight size={15} />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-zinc-900 dark:text-zinc-50">
                    <span className="font-medium">{it.actor ?? "System"}</span>{" "}
                    {inbound ? "added" : "removed"}{" "}
                    <span className="font-medium">{formatWeight(it.weight)}</span> of {it.item}
                    {it.grade ? ` (Grade ${it.grade})` : ""}
                  </div>
                  <div className="text-xs text-zinc-500">
                    {it.reason.replace(/_/g, " ")} · {formatTimestamp(it.at)}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
