import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge, stateVariant } from "@/components/ui/badge";
import { STATE_LABELS } from "@/lib/visits/state-machine";
import { formatTimestamp } from "@/lib/visits/format";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const q = String(params.q ?? "").trim();

  let visits: unknown[] = [];

  if (q.length >= 2) {
    const supabase = await createClient();

    const { data } = await supabase
      .from("visits")
      .select(`
        id, state, created_at,
        site:sites(name),
        supplier:suppliers(name, phone),
        declared_material_type:material_types(name)
      `)
      .or(
        `supplier.name.ilike.%${q}%,` +
        `id.eq.${q}`
      )
      .order("created_at", { ascending: false })
      .limit(50);

    visits = data ?? [];
  }

  return (
    <main className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/owner" className="text-sm text-gray-500 hover:underline">
          ← Dashboard
        </Link>
        <h1 className="text-2xl font-bold">Cross-site search</h1>
      </div>

      <form method="GET" action="/owner/search" className="flex gap-2">
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder="Supplier name or visit UUID…"
          className="flex-1 border rounded px-3 py-2 text-sm"
          autoFocus
        />
        <button
          type="submit"
          className="px-4 py-2 bg-black text-white text-sm rounded"
        >
          Search
        </button>
      </form>

      {q.length >= 2 && (
        <Card>
          <CardHeader>
            <span className="text-sm text-gray-600">
              {visits.length === 0
                ? `No results for "${q}"`
                : `${visits.length} result${visits.length !== 1 ? "s" : ""} for "${q}"`}
            </span>
          </CardHeader>
          {visits.length > 0 && (
            <CardContent className="p-0">
              <ul className="divide-y">
                {visits.map((v) => {
                  const visit = v as {
                    id: string;
                    state: string;
                    created_at: string;
                    site: unknown;
                    supplier: unknown;
                    declared_material_type: unknown;
                  };
                  const sup  = (Array.isArray(visit.supplier)  ? visit.supplier[0]  : visit.supplier)  as { name?: string; phone?: string } | null;
                  const mat  = (Array.isArray(visit.declared_material_type) ? visit.declared_material_type[0] : visit.declared_material_type) as { name?: string } | null;
                  const site = (Array.isArray(visit.site) ? visit.site[0] : visit.site) as { name?: string } | null;
                  return (
                    <li key={visit.id}>
                      <Link
                        href={`/visits/${visit.id}`}
                        className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 text-sm"
                      >
                        <div>
                          <div className="font-medium">{sup?.name ?? "—"}</div>
                          <div className="text-xs text-gray-500">
                            {site?.name ?? "—"} · {mat?.name ?? "—"}
                            {sup?.phone ? ` · ${sup.phone}` : ""}
                          </div>
                          <div className="text-xs text-gray-400 mt-0.5">
                            {formatTimestamp(visit.created_at)} · {visit.id}
                          </div>
                        </div>
                        <Badge variant={stateVariant(visit.state)}>
                          {STATE_LABELS[visit.state as keyof typeof STATE_LABELS] ?? visit.state}
                        </Badge>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          )}
        </Card>
      )}

      {q.length > 0 && q.length < 2 && (
        <p className="text-sm text-gray-500">Enter at least 2 characters to search.</p>
      )}

      {q.length === 0 && (
        <p className="text-sm text-gray-500">
          Search across all sites by supplier name or visit UUID.
        </p>
      )}
    </main>
  );
}
