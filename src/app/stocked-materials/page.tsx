import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { StockedMaterialsTable, type StockedRow } from "@/components/stock/StockedMaterialsTable";

// Every stocked material — supplier, type, weight, paid status — and the store
// check against it, in one module. Whoever counts the store (its keeper, or the
// site manager where there is none) ticks material off here; everyone else
// reads it. RLS scopes site-bound roles to their own site.
//
// The list defaults to what is still in stock: that is what a store check is
// about, and it keeps the page from shipping years of sold history to the
// browser. "Include sold" widens it when the history is what you want.
export const dynamic = "force-dynamic";

const CAN_CHECK = ["stock_keeper", "manager", "owner"];
const PAGE_LIMIT = 500;

export default async function StockedMaterialsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const me = await getProfile();
  if (!me) redirect("/login");
  const params = await searchParams;
  const includeSold = String(params.sold ?? "") === "1";
  // Searching in Postgres rather than shipping the whole log to the browser to
  // filter it there — this list grows with every lot, forever.
  const q = String(params.q ?? "").trim();
  const only = String(params.only ?? "");

  const supabase = await createClient();
  let query = supabase
    .from("stocked_materials")
    .select(`
      id, created_at, site_name, material_name, supplier_name, supplier_code,
      weight_kg, status, is_paid, check_status, counted_weight_kg,
      dispute_note, checked_at, checked_by_name
    `)
    .order("created_at", { ascending: false })
    .limit(PAGE_LIMIT);
  if (!includeSold) query = query.eq("status", "available");
  if (only === "disputed") query = query.eq("check_status", "disputed");
  if (only === "uncounted") query = query.is("check_status", null).eq("is_paid", true);
  if (q) {
    const safe = q.replace(/[,()*%]/g, "");
    query = query.or(
      `material_name.ilike.%${safe}%,supplier_name.ilike.%${safe}%,site_name.ilike.%${safe}%,supplier_code.ilike.%${safe}%`,
    );
  }
  const { data } = await query;

  const rows: StockedRow[] = (data ?? []).map((l) => ({
    id: l.id as string,
    date: (l.created_at as string) ?? "",
    supplier: (l.supplier_name as string) ?? "—",
    supplierCode: (l.supplier_code as string | null) ?? null,
    material: (l.material_name as string) ?? "—",
    weight: Number(l.weight_kg),
    site: (l.site_name as string) ?? "—",
    // A manual lot has no settlement behind it, so it has no paid state.
    paid: l.is_paid == null ? "—" : l.is_paid ? "Paid" : "Unpaid",
    inStock: l.status === "available",
    check: (l.check_status as StockedRow["check"]) ?? "unchecked",
    counted: l.counted_weight_kg != null ? Number(l.counted_weight_kg) : null,
    disputeNote: (l.dispute_note as string | null) ?? null,
    checkedBy: (l.checked_by_name as string | null) ?? null,
    checkedAt: (l.checked_at as string | null) ?? null,
  }));

  const canCheck = CAN_CHECK.includes(me.role);

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-bold">Stocked materials</h1>
        <p className="text-sm text-gray-500">
          {canCheck
            ? "Every material taken into stock. Confirm each paid lot is in the store, or raise a dispute."
            : "Every material taken into stock — supplier, type, weight, payment and the store check."}
        </p>
      </header>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">
              {includeSold ? "Stock log" : "In stock"} ({rows.length}{rows.length === PAGE_LIMIT ? "+" : ""})
            </h2>
            <Link
              href={includeSold ? "/stocked-materials" : "/stocked-materials?sold=1"}
              className="rounded border px-2 py-1 text-xs hover:bg-zinc-50"
            >
              {includeSold ? "In stock only" : "Include sold"}
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          <StockedMaterialsTable rows={rows} canCheck={canCheck} query={q} only={only} includeSold={includeSold} />
        </CardContent>
      </Card>
    </main>
  );
}
