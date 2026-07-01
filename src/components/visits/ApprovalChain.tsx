import type { VisitState } from "@/lib/visits/state-machine";

// The signature ledger element: the supply pipeline as a chain of stamped
// nodes (done / current / upcoming). Mirrors the real visit state machine.
// Pricing is where the manager prices (the node advances once priced); the
// owner then finalises ("Director OK"). There is no separate manager-approval
// node (#3/#6) — receiving submits straight to analysis.

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
  const nodes: { label: string; kind: "done" | "now" | "next" | "skip" | "reject" }[] = [];

  // awaiting_manager is retired (→ analysis gate). At awaiting_price_approval the
  // manager has priced (Pricing done) and the visit sits at the Director OK gate.
  const atApprovalGate = state === "awaiting_price_approval";
  const effectiveState: VisitState =
    state === "awaiting_manager" ? "in_qc" : atApprovalGate ? "pricing" : state;
  const pricingIdx = ORDER.findIndex((n) => n.state === "pricing");

  // "Director OK" — owner approves/finalises the price, rendered after Pricing.
  const directorKind = (currentIdx: number): "done" | "now" | "next" =>
    priceApproved ? "done" : atApprovalGate || currentIdx > pricingIdx ? "now" : "next";

  if (exited) {
    // No-agreement off-ramp: completed up to pricing, then an Exited terminal.
    for (const n of ORDER) {
      if (n.state === "in_processing" && entryPath === "processed") {
        nodes.push({ label: n.label, kind: "skip" });
      } else if (n.state === "in_accounting" || n.state === "awaiting_stock_intake" || n.state === "stocked") {
        // never reached
      } else {
        nodes.push({ label: n.label, kind: "done" });
        if (n.state === "pricing") {
          nodes.push({ label: "Director OK", kind: priceApproved ? "done" : "skip" });
        }
      }
    }
    nodes.push({ label: "Exited", kind: "reject" });
  } else {
    const currentIdx = ORDER.findIndex((n) => n.state === effectiveState);
    ORDER.forEach((n, i) => {
      if (n.state === "in_processing" && entryPath === "processed") {
        nodes.push({ label: n.label, kind: "skip" });
      } else if (i < currentIdx) {
        nodes.push({ label: n.label, kind: "done" });
      } else if (i === currentIdx) {
        // At the approval gate the Pricing node is already done (manager priced).
        nodes.push({ label: n.label, kind: atApprovalGate && n.state === "pricing" ? "done" : "now" });
      } else {
        nodes.push({ label: n.label, kind: "next" });
      }
      if (n.state === "pricing") {
        nodes.push({ label: "Director OK", kind: directorKind(currentIdx) });
      }
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
