import Link from "next/link";
import { listVisitsByState, listVisitsDoneAfter } from "@/lib/visits/queries";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LiveWorkflow } from "@/components/visits/LiveWorkflow";
import { DoneList } from "@/components/visits/DoneList";
import { VisitQueueTable } from "@/components/visits/VisitQueueTable";
import { toQueueRows } from "@/lib/visits/queue-rows";

export default async function ProcessingHomePage() {
  const [queue, done] = await Promise.all([
    listVisitsByState(["in_processing"]),
    listVisitsDoneAfter("in_processing", { entryPath: "unprocessed" }),
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
