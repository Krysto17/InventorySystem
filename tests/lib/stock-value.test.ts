import { describe, it, expect } from "vitest";
import { buildCostBasis, uncostedKgAtHand, valueStock, type LotCostRow } from "@/lib/inventory/stock-value";

const lot = (o: Partial<LotCostRow> & { material_type_id: string }): LotCostRow => ({
  weight_kg: 0, cost_price_per_kg: null, status: "available", ...o,
});

describe("valuing the stock at hand", () => {
  it("weights the cost by kg, not by lot", () => {
    // 1000kg at ₦10 and 10kg at ₦1000 average to ₦19.80/kg, not ₦505.
    const basis = buildCostBasis([
      lot({ material_type_id: "m", weight_kg: 1000, cost_price_per_kg: 10 }),
      lot({ material_type_id: "m", weight_kg: 10, cost_price_per_kg: 1000 }),
    ]);
    expect(basis.get("m")).toBeCloseTo((1000 * 10 + 10 * 1000) / 1010, 6);
  });

  it("does not let uncosted lots drag the average down", () => {
    // The 3000kg with no recorded cost must not average in as ₦0/kg.
    const basis = buildCostBasis([
      lot({ material_type_id: "iron", weight_kg: 5000, cost_price_per_kg: 45 }),
      lot({ material_type_id: "iron", weight_kg: 3000, cost_price_per_kg: null }),
      lot({ material_type_id: "iron", weight_kg: 74, cost_price_per_kg: 0 }),
    ]);
    expect(basis.get("iron")).toBe(45);
  });

  it("values every kg at hand, including the uncosted ones", () => {
    const lots = [
      lot({ material_type_id: "iron", weight_kg: 5000, cost_price_per_kg: 45 }),
      lot({ material_type_id: "iron", weight_kg: 3000, cost_price_per_kg: null }),
    ];
    const { costPerKg, uncostedKg } = valueStock(lots);
    const kgAtHand = 8000;
    expect(kgAtHand * costPerKg.get("iron")!).toBe(360_000); // not 225_000
    expect(uncostedKg).toBe(3000);
  });

  it("falls back to what sold lots cost when nothing at hand is costed", () => {
    const basis = buildCostBasis([
      lot({ material_type_id: "iron", weight_kg: 422, cost_price_per_kg: null }),
      lot({ material_type_id: "iron", weight_kg: 100, cost_price_per_kg: 60, status: "sold" }),
    ]);
    expect(basis.get("iron")).toBe(60);
  });

  it("prefers stock at hand over sold history when both are costed", () => {
    const basis = buildCostBasis([
      lot({ material_type_id: "tin", weight_kg: 100, cost_price_per_kg: 40_000 }),
      lot({ material_type_id: "tin", weight_kg: 900, cost_price_per_kg: 20_000, status: "sold" }),
    ]);
    expect(basis.get("tin")).toBe(40_000);
  });

  it("has no basis for a material that was never costed", () => {
    const basis = buildCostBasis([lot({ material_type_id: "slag", weight_kg: 50, cost_price_per_kg: null })]);
    expect(basis.has("slag")).toBe(false);
  });

  it("ignores sold lots when counting what is uncosted at hand", () => {
    expect(uncostedKgAtHand([
      lot({ material_type_id: "m", weight_kg: 10, cost_price_per_kg: null }),
      lot({ material_type_id: "m", weight_kg: 999, cost_price_per_kg: null, status: "sold" }),
    ])).toBe(10);
  });
});
