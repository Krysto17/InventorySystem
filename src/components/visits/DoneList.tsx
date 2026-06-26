import Link from "next/link";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { STATE_LABELS, type VisitState } from "@/lib/visits/state-machine";
import { formatTimestamp } from "@/lib/visits/format";

type Row = {
  id: string;
  created_at: string;
  entry_path: "unprocessed" | "processed";
  state: VisitState;
  supplier: { name: string } | null;
  declared_material_type: { name: string } | null;
};

// The "done" half of a role's queue (#14): items the role has already treated,
// now moved on. Read-only history with their current pipeline state.
export function DoneList({ rows, title = "Recently completed" }: { rows: Row[]; title?: string }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-sm">{title}</h2>
          <Badge variant="default">{rows.length}</Badge>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <p className="px-4 py-3 text-sm text-gray-500">Nothing completed yet.</p>
        ) : (
          <ul className="divide-y">
            {rows.map((v) => (
              <li key={v.id}>
                <Link href={`/visits/${v.id}`} className="block px-4 py-3 hover:bg-gray-50">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-sm">{v.supplier?.name ?? "—"}</span>
                    <Badge variant="default">{STATE_LABELS[v.state] ?? v.state}</Badge>
                  </div>
                  <div className="text-xs text-gray-500">
                    {v.declared_material_type?.name ?? "—"} · {v.entry_path} ·{" "}
                    {formatTimestamp(v.created_at)}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
