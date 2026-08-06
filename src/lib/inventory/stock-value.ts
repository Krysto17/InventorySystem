// Valuing the stock at hand.
//
// Stock is valued at what it COST to buy. The cost lives on the lot
// (`stock_lots.cost_price_per_kg`), but not every lot has one — material taken
// in without a price recorded (a by-product, or an intake from before lot
// costing) carries none. Multiplying those kg by ₦0 made the dashboard value
// less stock than is actually on hand, and worse, the zero-cost kg dragged
// down the average applied to everything else.
//
// So the cost basis per material is the weighted average of the lots that DO
// carry a cost, and it is applied to every kg on hand. Uncosted stock is then
// valued at what the same material cost, instead of nothing.

export type LotCostRow = {
  material_type_id: string;
  weight_kg: number | string | null;
  cost_price_per_kg: number | string | null;
  status?: string | null;
};

export type StockValuation = {
  /** ₦/kg to value each material at; missing when nothing of it was ever costed. */
  costPerKg: Map<string, number>;
  /** kg on hand whose own lot carries no cost — valued from the average. */
  uncostedKg: number;
};

const n = (v: number | string | null | undefined) => Number(v ?? 0);

/**
 * Build the per-material cost basis from lot rows.
 *
 * Lots still at hand are the truest basis, so they are used alone when any of
 * them is costed. Only when a material has nothing costed at hand does it fall
 * back to what sold lots of it cost — better a historical purchase price than
 * ₦0.
 */
export function buildCostBasis(lots: LotCostRow[]): Map<string, number> {
  const agg = new Map<string, { atHand: { cost: number; kg: number }; sold: { cost: number; kg: number } }>();

  for (const l of lots) {
    const rate = n(l.cost_price_per_kg);
    const kg = n(l.weight_kg);
    if (rate <= 0 || kg <= 0) continue; // uncosted lots must not dilute the average
    const id = l.material_type_id;
    const cur = agg.get(id) ?? { atHand: { cost: 0, kg: 0 }, sold: { cost: 0, kg: 0 } };
    const bucket = l.status === "sold" ? cur.sold : cur.atHand;
    bucket.cost += kg * rate;
    bucket.kg += kg;
    agg.set(id, cur);
  }

  const basis = new Map<string, number>();
  for (const [id, a] of agg) {
    const b = a.atHand.kg > 0 ? a.atHand : a.sold;
    if (b.kg > 0) basis.set(id, b.cost / b.kg);
  }
  return basis;
}

/** How many kg at hand have no cost on their own lot (so are valued by average). */
export function uncostedKgAtHand(lots: LotCostRow[]): number {
  return lots
    .filter((l) => l.status !== "sold" && n(l.cost_price_per_kg) <= 0)
    .reduce((s, l) => s + n(l.weight_kg), 0);
}

export function valueStock(lots: LotCostRow[]): StockValuation {
  return { costPerKg: buildCostBasis(lots), uncostedKg: uncostedKgAtHand(lots) };
}
