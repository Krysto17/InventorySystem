import { listVisitsByState, listVisitsDoneAfter } from "@/lib/visits/queries";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LiveWorkflow } from "@/components/visits/LiveWorkflow";
import { DoneList } from "@/components/visits/DoneList";
import { VisitQueueTable } from "@/components/visits/VisitQueueTable";
import { toQueueRows } from "@/lib/visits/queue-rows";
import { Greeting } from "@/components/dashboard/Greeting";

export default async function ReceivingHomePage() {
  const [queue, done] = await Promise.all([
    listVisitsByState(["in_receiving"]),
    listVisitsDoneAfter("in_receiving"),
  ]);
  return (
    <main className="p-6 max-w-4xl mx-auto space-y-6">
      <header>
        <Greeting />
        <h2 className="text-xl font-semibold">Receiving</h2>
        <p className="text-sm text-gray-500">{queue.length} visit{queue.length !== 1 ? "s" : ""} pending analysis</p>
      </header>

      <LiveWorkflow />

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-sm">Queue</h2>
            <Badge variant="blue">{queue.length}</Badge>
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
