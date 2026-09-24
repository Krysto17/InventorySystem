import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The mixing batch must submit the lots the operator actually picked.
 *
 * It did not. The checkboxes carried `name="lot_ids"` and were rendered from
 * the FILTERED list, so only picked lots that happened to still be on screen
 * were posted. Filtering or searching after choosing — the normal way to build
 * a mix from several materials — silently dropped the earlier picks from the
 * submission, while the computed total above still counted them from the full
 * lot array. The operator saw the weight they built and got a lighter batch,
 * and on approval only the attached lots left stock.
 *
 * The fix makes `picked` the single source of truth for both: it holds the lot
 * objects, the total sums them, and hidden inputs post them regardless of what
 * the filter is showing.
 */
describe("cost-price batch selection", () => {
  const src = readFileSync("src/components/reports/MixingBatchTool.tsx", "utf8");

  it("1. the rendered checkbox is not what submits the lot", () => {
    // This is the regression itself: an unrendered checkbox posts nothing.
    expect(src, "the checkbox must be a control, not the carrier")
      .not.toMatch(/type="checkbox"[^/]*name="lot_ids"/);
  });

  it("2. every picked lot is submitted, whatever the filter shows", () => {
    // Hidden inputs come from the picked selection, not from `visible`.
    expect(src).toMatch(/selected\.map\(\(l\) => \(\s*<input[^>]*type="hidden"[^>]*name="lot_ids"/);
  });

  it("3. the selection survives filtering, so the total cannot drift from it", () => {
    // `picked` holds the lots themselves; the old code re-derived the selection
    // from the current page of lots, which is where the two could disagree.
    expect(src, "picked holds the lot objects").toMatch(/useState<Map<string, Lot>>/);
    expect(src, "the total sums exactly what was picked")
      .toContain("const selected = [...picked.values()];");
    expect(src, "and never re-derives it from the visible page")
      .not.toMatch(/lots\.filter\(\(l\) => picked\.has/);
  });

  it("4. the total and the submission are computed from the same list", () => {
    // Both must read `selected` — that identity is the invariant that broke.
    expect(src).toContain("const totalWeight = selected.reduce((s, l) => s + l.weight, 0) + extraWeight;");
    const hiddenAt = src.indexOf('name="lot_ids"');
    expect(hiddenAt, "the lot inputs exist").toBeGreaterThan(-1);
    expect(src.slice(hiddenAt - 200, hiddenAt), "and they are driven by `selected`")
      .toContain("selected.map");
  });

  it("5. a picked lot hidden by a filter can still be removed", () => {
    // Sticky picks would otherwise be unreachable once filtered away.
    // the row in the computed-cost table, not the hidden-input block
    const rowAt = src.indexOf(">Stocked<");
    expect(rowAt, "the stocked row exists").toBeGreaterThan(-1);
    const row = src.slice(rowAt, src.indexOf("</tr>", rowAt));
    expect(row, "the computed table offers a remove control").toContain("onClick={() => toggle(l)}");
  });
});
