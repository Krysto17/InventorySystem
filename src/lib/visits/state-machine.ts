export const VISIT_STATES = [
  "at_gate_in",
  "in_processing",
  "in_receiving",
  "pricing",
  "in_accounting",
  "awaiting_gate_exit",
  "exited",
  "awaiting_stock_intake",
  "stocked",
] as const;

export type VisitState = (typeof VISIT_STATES)[number];

export const TERMINAL_STATES: ReadonlySet<VisitState> = new Set(["exited", "stocked"]);

const FORWARD_TRANSITIONS: ReadonlyArray<readonly [VisitState, VisitState]> = [
  ["at_gate_in", "in_processing"],
  ["at_gate_in", "in_receiving"],
  ["in_processing", "in_receiving"],
  ["in_receiving", "pricing"],
  ["pricing", "in_accounting"],
  ["pricing", "awaiting_gate_exit"],
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
  at_gate_in: "At gate (intake)",
  in_processing: "Processing",
  in_receiving: "Receiving / analysis",
  pricing: "Pricing",
  in_accounting: "Accounting",
  awaiting_gate_exit: "Awaiting gate exit",
  exited: "Exited",
  awaiting_stock_intake: "Awaiting stock intake",
  stocked: "Stocked",
};
