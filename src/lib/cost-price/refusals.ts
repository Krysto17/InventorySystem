// 0160: the cost-price lifecycle refusals, as the sentences an operator reads.
// The database raises each with a stable code; nothing else about the refusal
// (lot ids, table names) is passed through.
const REFUSALS: Record<string, string> = {
  CP001: "Approved cost price runs cannot be changed.",
  CP002: "One or more selected lots are no longer available. Refresh the run before approving it.",
  CP003: "One or more selected lots are already in another batch awaiting approval.",
  CP004: "Only a batch awaiting approval can be approved.",
  CP005: "A batch needs at least one stock lot before it can be approved.",
};

export function costPriceRefusal(code: string | undefined | null): string | null {
  return (code && REFUSALS[code]) || null;
}
