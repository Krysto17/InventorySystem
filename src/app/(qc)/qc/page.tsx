import Link from "next/link";
import { listVisitsByState, listQcCompletedVisits } from "@/lib/visits/queries";
import { getProfile } from "@/lib/auth/get-profile";
import { formatTimestamp } from "@/lib/visits/format";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LiveWorkflow } from "@/components/visits/LiveWorkflow";
import { DoneList } from "@/components/visits/DoneList";

export default async function QcHomePage() {
  const me = await getProfile();
  const [queue, done] = await Promise.all([
    listVisitsByState(["in_qc"]),
    me ? listQcCompletedVisits(me.id) : Promise.resolve([]),
  ]);
  return (
    <main className="p-6 max-w-4xl mx-auto space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Quality Control</h1>
        <p className="text-sm text-gray-500">
          {queue.length} visit{queue.length !== 1 ? "s" : ""} awaiting XRF analysis
        </p>
      </header>

      <LiveWorkflow />

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-sm">XRF queue</h2>
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
                  <Link href={`/visits/${v.id}`} className="block px-4 py-3 hover:bg-gray-50">
                    <div className="font-medium text-sm">{v.supplier?.name ?? "—"}</div>
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

      <DoneList rows={done} title="Analysed" />
    </main>
  );
}
