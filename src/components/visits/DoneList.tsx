import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { STATE_LABELS } from "@/lib/visits/state-machine";
import type { VisitQueueRow } from "@/lib/visits/queries";
import { VisitQueueTable } from "./VisitQueueTable";
import { toQueueRows } from "@/lib/visits/queue-rows";

// The "done" half of a role's queue (#14): items the role has already treated,
// now moved on. Read-only history as a sortable table (#8) with current stage.
export function DoneList({ rows, title = "Recently completed" }: { rows: VisitQueueRow[]; title?: string }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-sm">{title}</h2>
          <Badge variant="default">{rows.length}</Badge>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <VisitQueueTable
          rows={toQueueRows(rows, (r) => STATE_LABELS[r.state] ?? r.state)}
          emptyText="Nothing completed yet."
          extraLabel="Stage"
        />
      </CardContent>
    </Card>
  );
}
