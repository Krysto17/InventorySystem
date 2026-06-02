import Link from "next/link";
import { listVisitsByStateWithAnalysis } from "@/lib/visits/queries";
import { formatTimestamp, formatWeight } from "@/lib/visits/format";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default async function ManagerHomePage() {
  const queue = await listVisitsByStateWithAnalysis("pricing");
  return (
    <main className="p-6 max-w-4xl mx-auto space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Manager</h1>
        <p className="text-sm text-gray-500">{queue.length} visit{queue.length !== 1 ? "s" : ""} awaiting pricing</p>
      </header>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-sm">Pricing queue</h2>
            <Badge variant="purple">{queue.length}</Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {queue.length === 0 ? (
            <p className="px-4 py-3 text-sm text-gray-500">Queue is empty.</p>
          ) : (
            <ul className="divide-y">
              {queue.map((v) => (
                <li key={v.id}>
                  <Link href={`/visits/${v.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-gray-50">
                    <div>
                      <div className="font-medium text-sm">{v.supplier?.name ?? "—"}</div>
                      <div className="text-xs text-gray-500">
                        {v.declared_material_type?.name ?? "—"} · {formatTimestamp(v.created_at)}
                      </div>
                    </div>
                    <div className="text-right text-sm">
                      <div>Grade: <strong>{v.analysis?.grade ?? "—"}</strong></div>
                      <div className="text-xs text-gray-500">{v.analysis ? formatWeight(v.analysis.weight) : "—"}</div>
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
