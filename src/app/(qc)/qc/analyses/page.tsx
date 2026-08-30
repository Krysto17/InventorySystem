import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { one as get1 } from "@/lib/db/relation";
import { AnalysesSheet, type AnalysisRow } from "@/components/qc/AnalysesSheet";

// How many analyses one screen holds. The sheet renders every row it is given
// into a single table, so the page must bound what it asks for: the analyst who
// has been doing this since day one is past 1,100 records and gains one per
// material line forever. Fetching the lot — each with its material, visit and
// supplier nested — is what stopped this page loading at all.
const PAGE_SIZE = 200;
// PostgREST refuses to return more than 1,000 rows per request, so asking for
// more silently returns 1,000 and the page would lie about what it is showing.
const MAX_ROWS = 1000;

// #9: a sortable sheet of the XRF analyses this QC analyst has recorded.
export default async function QcAnalysesPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const me = await getProfile();
  if (!me || (me.role !== "qc" && me.role !== "owner")) notFound();
  const supabase = await createClient();

  const requested = Number(String((await searchParams).show ?? "")) || PAGE_SIZE;
  const limit = Math.min(Math.max(requested, PAGE_SIZE), MAX_ROWS);

  // The total is a counted head request — no rows cross the wire for it.
  const { count } = await supabase
    .from("xrf_records")
    .select("id", { count: "exact", head: true })
    .eq("recorded_by", me.id);

  const { data } = await supabase
    .from("xrf_records")
    .select(`
      id, result, weight_kg, mismatch, submitted, created_at, updated_at,
      visit_material:visit_materials!inner(
        unit_price, purchase_amount,
        material_type:material_types(name),
        visit:visits(id, supplier:suppliers(name))
      )
    `)
    .eq("recorded_by", me.id)
    // `id` breaks the tie. Analyses are written a batch at a time, so many rows
    // share a created_at to the microsecond — measured on real data, 1,201 rows
    // held only 24 distinct timestamps. Ordering on the timestamp alone leaves
    // Postgres free to return tied rows in any order, so the window shifted
    // between one page size and the next.
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);

  const rows: AnalysisRow[] = (data ?? []).map((x) => {
    const vm = get1((x as { visit_material: unknown }).visit_material) as {
      material_type?: unknown;
      visit?: unknown;
      unit_price?: number | null;
      purchase_amount?: number | null;
    } | null;
    const material = (get1(vm?.material_type) as { name?: string } | null)?.name ?? "—";
    const visit = get1(vm?.visit) as { id?: string; supplier?: unknown } | null;
    const supplier = (get1(visit?.supplier) as { name?: string } | null)?.name ?? "—";
    return {
      id: x.id as string,
      visitId: (visit?.id as string) ?? "",
      date: (x.updated_at as string) ?? (x.created_at as string),
      supplier,
      material,
      result: (x.result as string | null) ?? null,
      qcWeight: x.weight_kg != null ? Number(x.weight_kg) : null,
      mismatch: !!x.mismatch,
      submitted: !!x.submitted,
      unitPrice: vm?.unit_price != null ? Number(vm.unit_price) : null,
    };
  });

  const total = count ?? rows.length;
  const more = total > rows.length;
  // A request can never return more than MAX_ROWS, so past that point there is
  // nothing left to offer — a "Load more" would reload the same page.
  const canLoadMore = more && limit < MAX_ROWS;
  // Sorting happens in the browser over what was loaded, so say what that is
  // rather than let the newest 200 look like the whole history.
  const showing = !more
    ? `${total} XRF analys${total === 1 ? "is" : "es"} recorded`
    : canLoadMore
      ? `Showing the ${rows.length} most recent of ${total} analyses`
      : `Showing the ${rows.length} most recent of ${total} analyses — the oldest ${total - rows.length} are not reachable from this screen`;

  return (
    <main className="p-6 max-w-4xl mx-auto space-y-6">
      <header>
        <h1 className="text-2xl font-bold">My analyses</h1>
        <p className="text-sm text-gray-500">{showing}</p>
      </header>
      <Card>
        <CardHeader>
          <h2 className="font-semibold text-sm">Analysis history</h2>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <AnalysesSheet rows={rows} />
        </CardContent>
      </Card>
      {canLoadMore && (
        <div className="flex justify-center">
          <Link
            href={`/qc/analyses?show=${Math.min(limit + PAGE_SIZE, MAX_ROWS)}`}
            className="rounded border px-4 py-2 text-sm hover:bg-gray-50"
          >
            Load {Math.min(PAGE_SIZE, total - rows.length)} more
          </Link>
        </div>
      )}
    </main>
  );
}
