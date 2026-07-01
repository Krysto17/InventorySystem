export const VISIT_STATES = [
  "in_processing",
  "in_receiving",
  "awaiting_manager",
  "in_qc",
  "pricing",
  "awaiting_price_approval",
  "awaiting_gate_exit",
  "in_accounting",
  "exited",
  "awaiting_stock_intake",
  "stocked",
] as const;

export type VisitState = (typeof VISIT_STATES)[number];

export const TERMINAL_STATES: ReadonlySet<VisitState> = new Set(["exited", "stocked"]);

const FORWARD_TRANSITIONS: ReadonlyArray<readonly [VisitState, VisitState]> = [
  ["in_processing", "in_receiving"],
  ["in_receiving", "in_qc"],
  ["in_receiving", "pricing"],
  ["in_qc", "pricing"],
  ["pricing", "awaiting_price_approval"],
  ["awaiting_price_approval", "in_accounting"],
  ["awaiting_price_approval", "pricing"],
  ["pricing", "in_accounting"],
  ["pricing", "awaiting_gate_exit"],
  ["pricing", "exited"],
  ["awaiting_gate_exit", "exited"],
  ["in_accounting", "awaiting_stock_intake"],
  ["awaiting_stock_intake", "stocked"],
];

export function isLegalForwardTransition(from: VisitState, to: VisitState): boolean {
  return FORWARD_TRANSITIONS.some(([a, b]) => a === from && b === to);
}

export function isVisitOpen(state: VisitState): boolean {
  return !TERMINAL_STATES.has(state);
}

export const STATE_LABELS: Record<VisitState, string> = {
  in_processing: "Processing",
  in_receiving: "Receiving / magnetic analysis",
  awaiting_manager: "Awaiting manager approval",
  in_qc: "QC / XRF analysis",
  pricing: "Pricing",
  awaiting_price_approval: "Awaiting owner approval",
  awaiting_gate_exit: "Awaiting gate release",
  in_accounting: "Accounting",
  exited: "Exited",
  awaiting_stock_intake: "Awaiting stock intake",
  stocked: "Stocked",
};
