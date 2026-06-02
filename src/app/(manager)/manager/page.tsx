import Link from "next/link";
import { listVisitsByStateWithAnalysis } from "@/lib/visits/queries";
import { formatTimestamp, formatWeight } from "@/lib/visits/format";

export default async function ManagerHomePage() {
  const queue = await listVisitsByStateWithAnalysis("pricing");
  return (
    <main className="p-6 max-w-5xl mx-auto space-y-4">
      <h1 className="text-2xl font-semibold">Manager — {queue.length} pending</h1>
      {queue.length === 0 ? (
        <p className="text-sm text-gray-600">Queue is empty.</p>
      ) : (
        <ul className="border rounded divide-y">
          {queue.map((v) => (
            <li key={v.id}>
              <Link href={`/visits/${v.id}`} className="block px-3 py-2 hover:bg-gray-50">
                <div className="flex justify-between">
                  <div>
                    <div className="font-medium">{v.supplier?.name ?? "—"}</div>
                    <div className="text-sm text-gray-600">
                      {v.declared_material_type?.name ?? "—"} · {formatTimestamp(v.created_at)}
                    </div>
                  </div>
                  <div className="text-sm text-right">
                    <div>
                      Grade: <strong>{v.analysis?.grade ?? "—"}</strong>
                    </div>
                    <div>{v.analysis ? formatWeight(v.analysis.weight) : "—"}</div>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
