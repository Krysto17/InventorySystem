import { formatTimestamp } from "@/lib/visits/format";

type Event = {
  id: string;
  event_type: string;
  created_at: string;
  actor_name: string | null;
  payload: Record<string, unknown>;
};

function describeEvent(e: Event): string {
  switch (e.event_type) {
    case "visit_created": return "Visit created";
    case "state_changed":
      return `State: ${(e.payload as { from?: string }).from ?? "?"} → ${(e.payload as { to?: string }).to ?? "?"}`;
    case "record_created":
      return `Record created on ${(e.payload as { table?: string }).table ?? "?"}`;
    case "record_edited":
      return `Record edited on ${(e.payload as { table?: string }).table ?? "?"}`;
    case "gate_exit_authorized": return "Gate exit authorized";
    case "gate_released": return "Released through gate";
    case "owner_override": return "Owner override";
    default: return e.event_type;
  }
}

export function AuditTrail({ events }: { events: Event[] }) {
  return (
    <details className="border rounded p-3">
      <summary className="cursor-pointer text-sm font-medium">
        Audit trail ({events.length})
      </summary>
      <ul className="mt-3 space-y-2 text-sm">
        {events.map((e) => (
          <li key={e.id} className="border-l-2 border-gray-200 pl-3">
            <div className="font-medium">{describeEvent(e)}</div>
            <div className="text-xs text-gray-500">
              {e.actor_name ?? "—"} · {formatTimestamp(e.created_at)}
            </div>
            {e.event_type === "record_edited" && (
              <pre className="text-xs bg-gray-50 p-2 mt-1 rounded overflow-x-auto">
                {JSON.stringify((e.payload as { diff?: unknown }).diff ?? {}, null, 2)}
              </pre>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
