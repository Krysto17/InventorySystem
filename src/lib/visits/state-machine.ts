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

// Pipeline progress rank (lower = earlier stage, higher = further along). Used
// to arrange the live workflow in the order of progress. Branch/terminal states
// slot in at the point they leave the main line.
export const PROGRESS_ORDER: Record<VisitState, number> = {
  in_processing: 0,
  in_receiving: 1,
  awaiting_manager: 2,
  in_qc: 3,
  pricing: 4,
  awaiting_price_approval: 5,
  awaiting_gate_exit: 6,
  in_accounting: 7,
  awaiting_stock_intake: 8,
  exited: 9,
  stocked: 10,
};

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
