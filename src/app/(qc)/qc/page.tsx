import { listVisitsByState, listQcCompletedVisits } from "@/lib/visits/queries";
import { getProfile } from "@/lib/auth/get-profile";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LiveWorkflow } from "@/components/visits/LiveWorkflow";
import { DoneList } from "@/components/visits/DoneList";
import { VisitQueueTable } from "@/components/visits/VisitQueueTable";
import { toQueueRows } from "@/lib/visits/queue-rows";

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
          <VisitQueueTable rows={toQueueRows(queue)} />
        </CardContent>
      </Card>

      <DoneList rows={done} title="Analysed" />
    </main>
  );
}
