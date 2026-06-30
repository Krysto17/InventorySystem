import type { VisitQueueRow } from "./queries";
import type { QueueRow } from "@/components/visits/VisitQueueTable";

// Map visit queue rows → the sortable-table row shape (#8).
export function toQueueRows(
  rows: VisitQueueRow[],
  extra?: (r: VisitQueueRow) => string | null,
): QueueRow[] {
  return rows.map((r) => ({
    id: r.id,
    supplier: r.supplier?.name ?? "—",
    material: r.declared_material_type?.name ?? "—",
    weight: r.weight,
    date: r.created_at,
    extra: extra ? extra(r) : null,
  }));
}
