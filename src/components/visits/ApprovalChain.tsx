import type { VisitState } from "@/lib/visits/state-machine";

// The signature ledger element: the supply pipeline as a chain of stamped
// nodes (done / current / upcoming). Mirrors the real visit state machine.
// "Pricing" is where the Manager drafts and the Owner (Director) finalises.

type Node = { state: VisitState; label: string };

const ORDER: Node[] = [
  { state: "in_processing", label: "Processing" },
  { state: "in_receiving", label: "Receiving" },
  { state: "in_qc", label: "Analysis" },
  { state: "pricing", label: "Pricing" },
  { state: "in_accounting", label: "Accounting" },
  { state: "awaiting_stock_intake", label: "Intake" },
  { state: "stocked", label: "Stocked" },
];

function Dot({ label, kind }: { label: string; kind: "done" | "now" | "next" | "skip" | "reject" }) {
  const base = "mono rounded-full border-[1.5px] px-2.5 py-[3px] text-[10px] font-semibold tracking-[0.03em] whitespace-nowrap";
  const styles: Record<typeof kind, string> = {
    done: "bg-approve border-approve text-white",
    now: "bg-pending-soft border-pending text-pending",
    next: "bg-panel border-line text-ink-2",
    skip: "bg-panel border-line border-dashed text-ink-2 opacity-55",
    reject: "bg-reject border-reject text-white",
  };
  return <span className={`${base} ${styles[kind]}`}>{label}</span>;
}

function Link({ done }: { done: boolean }) {
  return <span className={`h-[1.5px] w-5 ${done ? "bg-approve" : "bg-line"}`} />;
}

export function ApprovalChain({
  state,
  entryPath,
  priceApproved = false,
}: {
  state: VisitState;
  entryPath?: "unprocessed" | "processed";
  priceApproved?: boolean;
}) {
  const exited = state === "exited";
  // No-agreement off-ramp: completed up to pricing, then an Exited terminal.
  const nodes: { label: string; kind: "done" | "now" | "next" | "skip" | "reject" }[] = [];

  // The "Director OK" node: green once the owner finalises the price; pending
  // while pricing is in progress; upcoming before that.
  const pricingIdx = ORDER.findIndex((n) => n.state === "pricing");
  const directorKind = (currentIdx: number): "done" | "now" | "next" =>
    priceApproved ? "done" : currentIdx >= pricingIdx ? "now" : "next";

  if (exited) {
    for (const n of ORDER) {
      if (n.state === "in_processing" && entryPath === "processed") {
        nodes.push({ label: n.label, kind: "skip" });
      } else if (n.state === "in_accounting" || n.state === "awaiting_stock_intake" || n.state === "stocked") {
        // never reached
      } else {
        nodes.push({ label: n.label, kind: "done" });
        if (n.state === "pricing") nodes.push({ label: "Director OK", kind: priceApproved ? "done" : "skip" });
      }
    }
    nodes.push({ label: "Exited", kind: "reject" });
  } else {
    const currentIdx = ORDER.findIndex((n) => n.state === state);
    ORDER.forEach((n, i) => {
      if (n.state === "in_processing" && entryPath === "processed") {
        nodes.push({ label: n.label, kind: "skip" });
      } else if (i < currentIdx) {
        nodes.push({ label: n.label, kind: "done" });
      } else if (i === currentIdx) {
        nodes.push({ label: n.label, kind: "now" });
      } else {
        nodes.push({ label: n.label, kind: "next" });
      }
      if (n.state === "pricing") nodes.push({ label: "Director OK", kind: directorKind(currentIdx) });
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-y-2">
      {nodes.map((n, i) => (
        <div key={i} className="flex items-center">
          <Dot label={n.label} kind={n.kind} />
          {i < nodes.length - 1 && <Link done={n.kind === "done"} />}
        </div>
      ))}
    </div>
  );
}
