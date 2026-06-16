import Link from "next/link";
import { listVisitsByState } from "@/lib/visits/queries";
import { formatTimestamp } from "@/lib/visits/format";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LiveWorkflow } from "@/components/visits/LiveWorkflow";

export default async function ProcessingHomePage() {
  const queue = await listVisitsByState(["in_processing"]);
  return (
    <main className="p-6 max-w-4xl mx-auto space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Processing</h1>
          <p className="text-sm text-gray-500">{queue.length} visit{queue.length !== 1 ? "s" : ""} pending</p>
        </div>
        <Link href="/processing/intake" className="px-4 py-2 bg-black text-white rounded text-sm">
          + New visit intake
        </Link>
      </header>

      <LiveWorkflow />

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-sm">Queue</h2>
            <Badge variant="yellow">{queue.length}</Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {queue.length === 0 ? (
            <p className="px-4 py-3 text-sm text-gray-500">Queue is empty.</p>
          ) : (
            <ul className="divide-y">
              {queue.map((v) => (
                <li key={v.id}>
                  <Link href={`/visits/${v.id}`} className="block px-4 py-3 hover:bg-gray-50">
                    <div className="font-medium text-sm">{v.supplier?.name ?? "—"}</div>
                    <div className="text-xs text-gray-500">
                      {v.declared_material_type?.name ?? "—"} ·{" "}
                      {formatTimestamp(v.created_at)}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
