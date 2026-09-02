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

  // Ask for one row more than the page shows. Whether that row comes back is the
  // only thing the exact count was really being asked, and answering it that way
  // cost a second scan of every record this analyst owns — ~250 ms in production
  // and unimprovable by any index, because `recorded_by` selects all of them.
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
    .limit(limit + 1);

  const raw = data ?? [];
  // The extra row is a signal, never a displayed row.
  const hasMore = raw.length > limit;

  const rows: AnalysisRow[] = raw.slice(0, limit).map((x) => {
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

  // At the ceiling the extra row cannot answer the question: PostgREST caps every
  // response at MAX_ROWS, so asking for MAX_ROWS + 1 still yields MAX_ROWS and
  // `hasMore` falls silent. A full page at the cap therefore means older records
  // exist that this screen cannot reach, whatever the probe says.
  const atCap = rows.length >= MAX_ROWS;
  // A request can never return more than MAX_ROWS, so past that point there is
  // nothing left to offer — a "Load more" would reload the same page.
  const canLoadMore = hasMore && limit < MAX_ROWS;
  // Sorting happens in the browser over what was loaded, so say what that is
  // rather than let the newest 200 look like the whole history. When everything
  // fits, the count is exact and free — it is the rows in hand.
  const showing = atCap
    ? `Showing the ${rows.length} most recent analyses — older ones are not reachable from this screen`
    : hasMore
      ? `Showing the ${rows.length} most recent analyses`
      : `${rows.length} XRF analys${rows.length === 1 ? "is" : "es"} recorded`;

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
            Load {PAGE_SIZE} more
          </Link>
        </div>
      )}
    </main>
  );
}
