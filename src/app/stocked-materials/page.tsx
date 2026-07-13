import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { StockedMaterialsTable, type StockedRow } from "@/components/stock/StockedMaterialsTable";
import { one as g1 } from "@/lib/db/relation";

// Shared log of every stocked material — supplier, type, weight and paid status.
// Visible to every role (accounting especially) to track operations; RLS scopes
// site-bound roles to their own site, owner/accounting/GM see all sites.
export default async function StockedMaterialsPage() {
  const me = await getProfile();
  if (!me) redirect("/login");

  const supabase = await createClient();
  const { data } = await supabase
    .from("stock_lots")
    .select(`
      id, weight_kg, created_at,
      material:material_types(name),
      supplier:suppliers(name, supplier_code),
      site:sites(name),
      vm:visit_materials!stock_lots_ref_visit_material_id_fkey(
        visit:visits(settlement:batch_settlements(status))
      )
    `)
    .order("created_at", { ascending: false })
    .limit(1000);

  const rows: StockedRow[] = (data ?? []).map((l) => {
    const vm = g1<{ visit: unknown }>((l as { vm: unknown }).vm);
    const settlement = g1<{ status: string }>(g1<{ settlement: unknown }>(vm?.visit)?.settlement);
    // Stock from a supplier settlement is created on payment; a manual lot has
    // no settlement, so its paid state is not applicable.
    const paid: StockedRow["paid"] = vm
      ? settlement?.status === "paid" ? "Paid" : "Unpaid"
      : "—";
    return {
      id: l.id as string,
      date: (l.created_at as string) ?? "",
      supplier: g1<{ name: string }>((l as { supplier: unknown }).supplier)?.name ?? "—",
      supplierCode: g1<{ supplier_code: string }>((l as { supplier: unknown }).supplier)?.supplier_code ?? null,
      material: g1<{ name: string }>((l as { material: unknown }).material)?.name ?? "—",
      weight: Number(l.weight_kg),
      site: g1<{ name: string }>((l as { site: unknown }).site)?.name ?? "—",
      paid,
    };
  });

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-bold">Stocked materials</h1>
        <p className="text-sm text-gray-500">Every material taken into stock — supplier, type, weight and payment status.</p>
      </header>
      <Card>
        <CardHeader><h2 className="text-sm font-semibold">Stock log ({rows.length})</h2></CardHeader>
        <CardContent><StockedMaterialsTable rows={rows} /></CardContent>
      </Card>
    </main>
  );
}
