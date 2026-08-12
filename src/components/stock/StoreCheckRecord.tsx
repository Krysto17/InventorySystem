import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatTimestamp } from "@/lib/visits/format";
import { one as g1 } from "@/lib/db/relation";

const kg = (n: number) => `${n.toFixed(3)} kg`;

// What the store keeper found on the shelf, against what the books say. RLS
// scopes it: a site manager sees their own store, the owner sees every site.
export async function StoreCheckRecord() {
  const supabase = await createClient();

  const [{ data: lots }, { data: checks }] = await Promise.all([
    supabase.from("stock_lots")
      .select("id, weight_kg, created_at, site:sites(name), material:material_types(name)")
      .eq("status", "available")
      .order("created_at", { ascending: false }),
    supabase.from("stock_confirmations")
      .select(`
        stock_lot_id, status, counted_weight_kg, dispute_note, updated_at,
        keeper:profiles!stock_confirmations_checked_by_fkey(full_name)
      `),
  ]);

  const byLot = new Map((checks ?? []).map((c) => [c.stock_lot_id as string, c]));
  const rows = (lots ?? []).map((l) => {
    const c = byLot.get(l.id as string);
    return {
      id: l.id as string,
      material: g1<{ name: string }>((l as { material: unknown }).material)?.name ?? "—",
      site: g1<{ name: string }>((l as { site: unknown }).site)?.name ?? "—",
      bookWeight: Number(l.weight_kg),
      status: (c?.status as string | undefined) ?? "unchecked",
      counted: c?.counted_weight_kg != null ? Number(c.counted_weight_kg) : null,
      note: (c?.dispute_note as string | null) ?? null,
      keeper: g1<{ full_name: string }>((c as { keeper?: unknown } | undefined)?.keeper)?.full_name ?? null,
      checkedAt: (c?.updated_at as string | undefined) ?? null,
    };
  });

  if (rows.length === 0) return null;

  const confirmed = rows.filter((r) => r.status === "confirmed").length;
  const disputed = rows.filter((r) => r.status === "disputed").length;
  const unchecked = rows.length - confirmed - disputed;
  // The disputes matter most, then what is still uncounted.
  const order = { disputed: 0, unchecked: 1, confirmed: 2 } as Record<string, number>;
  rows.sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3));

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Store check</h2>
          <span className="flex gap-1">
            {disputed > 0 && <Badge variant="red">{disputed} disputed</Badge>}
            <Badge variant="default">{confirmed}/{rows.length} confirmed</Badge>
          </span>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <p className="px-4 pt-3 text-xs text-ink-2">
          What the store keeper found on the shelf against what the books say.
          {unchecked > 0 ? ` ${unchecked} lot${unchecked === 1 ? "" : "s"} not counted yet.` : ""}
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-ink-2">
                <th className="px-4 py-2 text-left">Material</th>
                <th className="px-4 py-2 text-left">Site</th>
                <th className="px-4 py-2 text-right">Books</th>
                <th className="px-4 py-2 text-right">Counted</th>
                <th className="px-4 py-2 text-left">Store keeper</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => {
                const short = r.counted != null && Math.abs(r.counted - r.bookWeight) > 0.0005;
                return (
                  <tr key={r.id}>
                    <td className="px-4 py-2">
                      <span className="font-medium">{r.material}</span>
                      {r.status === "disputed" && (
                        <span className="ml-2 rounded bg-reject px-1.5 py-0.5 text-[10px] font-medium text-white">Disputed</span>
                      )}
                      {r.status === "confirmed" && (
                        <span className="ml-2 rounded bg-approve-soft px-1.5 py-0.5 text-[10px] font-medium text-approve">✓ In store</span>
                      )}
                      {r.status === "unchecked" && (
                        <span className="ml-2 text-[10px] text-ink-2">not counted</span>
                      )}
                      {r.note && <span className="block text-xs text-reject">{r.note}</span>}
                    </td>
                    <td className="px-4 py-2 text-ink-2">{r.site}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{kg(r.bookWeight)}</td>
                    <td className={`px-4 py-2 text-right tabular-nums ${short ? "font-semibold text-reject" : ""}`}>
                      {r.counted != null ? kg(r.counted) : r.status === "disputed" ? "not found" : "—"}
                    </td>
                    <td className="px-4 py-2 text-xs text-ink-2">
                      {r.keeper ?? "—"}
                      {r.checkedAt ? <span className="block">{formatTimestamp(r.checkedAt)}</span> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
