import { describe, it, expect } from "vitest";
import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import type { DocumentProps } from "@react-pdf/renderer";
import { PriceSlipPdf } from "../../src/lib/pdf/templates/price-slip";
import { SupplyInvoicePdf } from "../../src/lib/pdf/templates/supply-invoice";

const el = (c: unknown, p: unknown) =>
  React.createElement(c as React.ComponentType<unknown>, p) as React.ReactElement<DocumentProps>;

describe("PDF templates render to valid buffers", () => {
  it("price slip", async () => {
    const data = {
      line_id: "a1b2c3d4-0000-0000-0000-000000000000",
      receipt_no: "192980",
      site_name: "New-Site",
      supplier_name: "CHRISTOPHER BABAYO",
      material_name: "Columbite",
      weight_kg: 104,
      unit_price: 22100,
      amount: 2298400,
      visit_created_at: new Date().toISOString(),
    };
    const buf = await renderToBuffer(el(PriceSlipPdf, { data, docId: "ABCD1234" }));
    expect(buf.length).toBeGreaterThan(500);
  });

  it("supply invoice with itemised other deductions", async () => {
    const data = {
      visit_id: "abcd1234ef",
      site_name: "New-Site",
      supplier_name: "CHRISTOPHER BABAYO",
      supplier_code: "SUP-NEW-0001",
      created_at: new Date().toISOString(),
      status: "pending",
      items: [{ material_name: "Columbite", weight_kg: 104, unit_price: 22100, amount: 2298400 }],
      materials_total: 2298400,
      light_bill_total: 1000,
      other_deductions: [{ label: "Transport", amount: 500 }, { label: "Loading", amount: 250 }],
      advance_deducted: 0,
      net_balance: 2296650,
      remaining_debt: 0,
    };
    const buf = await renderToBuffer(el(SupplyInvoicePdf, { data, docId: "XYZ99999" }));
    expect(buf.length).toBeGreaterThan(500);
  });
});
