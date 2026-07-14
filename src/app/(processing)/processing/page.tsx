import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { listVisitsByState, listVisitsDoneAfter } from "@/lib/visits/queries";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LiveWorkflow } from "@/components/visits/LiveWorkflow";
import { DoneList } from "@/components/visits/DoneList";
import { VisitQueueTable } from "@/components/visits/VisitQueueTable";
import { toQueueRows } from "@/lib/visits/queue-rows";
import { one as g1 } from "@/lib/db/relation";

export default async function ProcessingHomePage() {
  const supabase = await createClient();
  const [queue, done, { data: reopened }] = await Promise.all([
    listVisitsByState(["in_processing"]),
    listVisitsDoneAfter("in_processing", { entryPath: "unprocessed" }),
    supabase
      .from("processing_records")
      .select("visit_id, visit:visits(state, supplier:suppliers(name), site:sites(name))")
      .eq("fee_reopened", true),
  ]);
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

      {(reopened?.length ?? 0) > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-sm">Processing fee corrections requested</h2>
              <Badge variant="red">{reopened!.length}</Badge>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y">
              {(reopened ?? []).map((r) => {
                const v = g1<{ supplier: unknown; site: unknown }>((r as { visit: unknown }).visit);
                const sup = g1<{ name: string }>(v?.supplier);
                const site = g1<{ name: string }>(v?.site);
                return (
                  <li key={r.visit_id as string}>
                    <Link href={`/visits/${r.visit_id}`} className="flex items-center justify-between px-4 py-3 text-sm hover:bg-gray-50">
                      <span className="font-medium">{sup?.name ?? "—"}</span>
                      <span className="text-xs text-gray-500">{site?.name ?? "—"} · correct the machine usage</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      <LiveWorkflow />

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-sm">Queue</h2>
            <Badge variant="yellow">{queue.length}</Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <VisitQueueTable rows={toQueueRows(queue)} />
        </CardContent>
      </Card>

      <DoneList rows={done} />
    </main>
  );
}
