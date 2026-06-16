import { formatTimestamp } from "@/lib/visits/format";

export function VisitOriginCard({
  supplier,
  material,
  vehiclePlate,
  entryPath,
  createdAt,
  createdByName,
}: {
  supplier: { name: string; phone: string | null } | null;
  material: { name: string } | null;
  vehiclePlate: string | null;
  entryPath: "unprocessed" | "processed";
  createdAt: string;
  createdByName: string | null;
}) {
  return (
    <section className="border rounded p-4">
      <div className="text-xs uppercase text-gray-500 mb-1">Visit details</div>
      <div className="font-medium">{supplier?.name ?? "—"}</div>
      <div className="text-sm text-gray-600">{supplier?.phone ?? "—"}</div>
      <div className="text-sm mt-2">
        Vehicle: {vehiclePlate ?? "—"} · Declared: {material?.name ?? "—"} · Path: {entryPath}
      </div>
      <div className="text-xs text-gray-500 mt-2">
        Recorded by {createdByName ?? "—"} at {formatTimestamp(createdAt)}
      </div>
    </section>
  );
}
