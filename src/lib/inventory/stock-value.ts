// Valuing the stock at hand.
//
// Only material still at hand counts — anything sold is out of the yard and out
// of these figures, quantity and value alike.
//
// Stock is valued at what it COST to buy. The cost lives on the lot
// (`stock_lots.cost_price_per_kg`), but not every lot has one — material taken
// in without a price recorded (a by-product, or an intake from before lot
// costing) carries none. Multiplying those kg by ₦0 valued less stock than is
// actually on hand, and worse, the zero-cost kg dragged down the average
// applied to everything else.
//
// So the cost basis per material is the kg-weighted average of the lots at hand
// that DO carry a cost, and it is applied to every kg on hand.

export type LotCostRow = {
  material_type_id: string;
  weight_kg: number | string | null;
  cost_price_per_kg: number | string | null;
};

export type StockValuation = {
  /** ₦/kg to value each material at; missing when nothing at hand is costed. */
  costPerKg: Map<string, number>;
  /** kg at hand whose own lot carries no cost — valued from the average. */
  uncostedKg: number;
};

const n = (v: number | string | null | undefined) => Number(v ?? 0);

/**
 * Build the per-material cost basis from the lots at hand. Callers pass only
 * material still in stock; sold lots are none of this calculation's business.
 */
export function buildCostBasis(lotsAtHand: LotCostRow[]): Map<string, number> {
  const agg = new Map<string, { cost: number; kg: number }>();

  for (const l of lotsAtHand) {
    const rate = n(l.cost_price_per_kg);
    const kg = n(l.weight_kg);
    if (rate <= 0 || kg <= 0) continue; // uncosted lots must not dilute the average
    const cur = agg.get(l.material_type_id) ?? { cost: 0, kg: 0 };
    cur.cost += kg * rate;
    cur.kg += kg;
    agg.set(l.material_type_id, cur);
  }

  const basis = new Map<string, number>();
  for (const [id, a] of agg) if (a.kg > 0) basis.set(id, a.cost / a.kg);
  return basis;
}

/** How many kg at hand have no cost on their own lot (so are valued by average). */
export function uncostedKgAtHand(lotsAtHand: LotCostRow[]): number {
  return lotsAtHand
    .filter((l) => n(l.cost_price_per_kg) <= 0)
    .reduce((s, l) => s + n(l.weight_kg), 0);
}

export function valueStock(lotsAtHand: LotCostRow[]): StockValuation {
  return { costPerKg: buildCostBasis(lotsAtHand), uncostedKg: uncostedKgAtHand(lotsAtHand) };
}
