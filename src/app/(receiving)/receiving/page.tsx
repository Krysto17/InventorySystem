import Link from "next/link";
import { listVisitsByState } from "@/lib/visits/queries";
import { formatTimestamp } from "@/lib/visits/format";

export default async function ReceivingHomePage() {
  const queue = await listVisitsByState(["in_receiving"]);
  return (
    <main className="p-6 max-w-5xl mx-auto space-y-4">
      <h1 className="text-2xl font-semibold">Receiving — {queue.length} pending</h1>
      {queue.length === 0 ? (
        <p className="text-sm text-gray-600">Queue is empty.</p>
      ) : (
        <ul className="border rounded divide-y">
          {queue.map((v) => (
            <li key={v.id}>
              <Link href={`/visits/${v.id}`} className="block px-3 py-2 hover:bg-gray-50">
                <div className="font-medium">{v.supplier?.name ?? "—"}</div>
                <div className="text-sm text-gray-600">
                  {v.declared_material_type?.name ?? "—"} · {v.entry_path} ·{" "}
                  {v.vehicle_plate ?? "no plate"} · {formatTimestamp(v.created_at)}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
