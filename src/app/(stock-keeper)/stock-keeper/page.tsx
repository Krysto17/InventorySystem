import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { StockCheckList, type LotRow } from "@/components/stock/StockCheckList";
import { one as g1 } from "@/lib/db/relation";

// The keeper's whole app: the material the books say is in their store, to be
// walked through and ticked off. Nothing else is on their login.
export const dynamic = "force-dynamic";

export default async function StockKeeperPage() {
  const me = await getProfile();
  if (!me || (me.role !== "stock_keeper" && me.role !== "owner")) redirect("/login");

  const supabase = await createClient();
  // RLS scopes lots to the keeper's own site.
  const [{ data: lots }, { data: checks }] = await Promise.all([
    supabase.from("stock_lots")
      .select("id, weight_kg, created_at, material:material_types(name)")
      .eq("status", "available")
      .order("created_at", { ascending: false }),
    supabase.from("stock_confirmations")
      .select("stock_lot_id, status, counted_weight_kg, dispute_note"),
  ]);

  const byLot = new Map(
    (checks ?? []).map((c) => [c.stock_lot_id as string, c]),
  );

  const rows: LotRow[] = (lots ?? []).map((l) => {
    const check = byLot.get(l.id as string);
    return {
      id: l.id as string,
      material: g1<{ name: string }>((l as { material: unknown }).material)?.name ?? "—",
      weightKg: Number(l.weight_kg),
      takenInAt: l.created_at as string,
      status: (check?.status as LotRow["status"]) ?? "unchecked",
      countedWeightKg: check?.counted_weight_kg != null ? Number(check.counted_weight_kg) : null,
      disputeNote: (check?.dispute_note as string | null) ?? null,
    };
  });

  const totalKg = rows.reduce((s, r) => s + r.weightKg, 0);

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-bold">Store check</h1>
        <p className="text-sm text-ink-2">
          {rows.length} lot{rows.length === 1 ? "" : "s"} · {totalKg.toFixed(3)} kg on the books
          {me.site_name ? ` at ${me.site_name}` : ""}
        </p>
      </header>

      <Card>
        <CardHeader><h2 className="text-sm font-semibold">Stocked materials</h2></CardHeader>
        <CardContent>
          {rows.length === 0
            ? <p className="text-sm text-ink-2">No material in stock for your store.</p>
            : <StockCheckList lots={rows} />}
        </CardContent>
      </Card>
    </main>
  );
}
