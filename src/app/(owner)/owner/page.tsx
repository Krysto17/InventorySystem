import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatNaira, formatTimestamp, formatWeight } from "@/lib/visits/format";
import { approveBulkSale, rejectBulkSale } from "@/app/(inventory)/inventory/bulk-sales/actions";

export default async function OwnerHomePage() {
  const supabase = await createClient();

  const { data: awaiting } = await supabase
    .from("visits")
    .select(`id, created_at, state, vehicle_plate,
             site:sites(name),
             supplier:suppliers(name, phone),
             declared_material_type:material_types(name)`)
    .eq("state", "awaiting_gate_exit")
    .order("created_at", { ascending: true });

  const { data: pendingSales } = await supabase
    .from("bulk_sales")
    .select(`
      id, buyer_name, buyer_phone, grade, weight, unit_price, total, sold_at,
      site:sites(name),
      material_type:material_types(name),
      recorded_by_profile:profiles!bulk_sales_recorded_by_fkey(full_name)
    `)
    .eq("approval_status", "pending")
    .order("created_at", { ascending: true });

  return (
    <main className="p-6 max-w-6xl mx-auto space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">Owner — cross-site overview</h1>
      </header>

      <nav className="flex flex-wrap gap-3 text-sm">
        <Link href="/owner/employees" className="px-3 py-2 border rounded">Employees</Link>
        <Link href="/owner/material-types" className="px-3 py-2 border rounded">Material types</Link>
        <Link href="/owner/machines" className="px-3 py-2 border rounded">Machines</Link>
        <Link href="/owner/visits" className="px-3 py-2 border rounded">All visits</Link>
      </nav>

      <section>
        <h2 className="font-semibold mb-2">
          Awaiting gate sign-off ({awaiting?.length ?? 0})
        </h2>
        {!awaiting || awaiting.length === 0 ? (
          <p className="text-sm text-gray-600">No visits awaiting authorization.</p>
        ) : (
          <ul className="border rounded divide-y">
            {awaiting.map((v) => {
              const sup = v.supplier as unknown as { name?: string; phone?: string | null } | null;
              const mat = v.declared_material_type as unknown as { name?: string } | null;
              const site = v.site as unknown as { name?: string } | null;
              return (
                <li key={v.id}>
                  <Link href={`/visits/${v.id}`} className="block px-3 py-2 hover:bg-gray-50">
                    <div className="flex justify-between">
                      <div>
                        <div className="font-medium">{sup?.name ?? "—"}</div>
                        <div className="text-sm text-gray-600">
                          {site?.name ?? "—"} · {mat?.name ?? "—"} ·{" "}
                          {v.vehicle_plate ?? "no plate"}
                        </div>
                      </div>
                      <div className="text-sm text-gray-500">
                        {formatTimestamp(v.created_at)}
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h2 className="font-semibold mb-2">
          Pending bulk sales ({pendingSales?.length ?? 0})
        </h2>
        {!pendingSales || pendingSales.length === 0 ? (
          <p className="text-sm text-gray-600">No pending bulk sales.</p>
        ) : (
          <ul className="border rounded divide-y">
            {pendingSales.map((s) => {
              const mat = s.material_type as unknown as { name?: string } | null;
              const site = s.site as unknown as { name?: string } | null;
              const rec = (s as { recorded_by_profile: unknown }).recorded_by_profile;
              const recName =
                (Array.isArray(rec)
                  ? (rec[0] as { full_name?: string })?.full_name
                  : (rec as { full_name?: string } | null)?.full_name) ?? "—";
              return (
                <li key={s.id as string} className="px-3 py-3">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="font-medium">
                        {s.buyer_name as string}
                        {s.buyer_phone ? (
                          <span className="text-gray-500 font-normal"> · {s.buyer_phone as string}</span>
                        ) : null}
                      </div>
                      <div className="text-sm text-gray-600">
                        {site?.name ?? "—"} · {mat?.name ?? "—"}
                        {s.grade ? ` · Grade ${s.grade}` : ""}
                        {" · "}{formatWeight(Number(s.weight))} ×{" "}
                        {formatNaira(Number(s.unit_price))} ={" "}
                        <strong>{formatNaira(Number(s.total))}</strong>
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        Submitted by {recName} · {formatTimestamp(s.sold_at as string)}
                      </div>
                    </div>
                    <div className="flex gap-2 ml-4 shrink-0">
                      <form action={approveBulkSale}>
                        <input type="hidden" name="id" value={s.id as string} />
                        <button
                          type="submit"
                          className="px-3 py-1 bg-green-700 text-white text-xs rounded"
                        >
                          Approve
                        </button>
                      </form>
                      <form action={rejectBulkSale}>
                        <input type="hidden" name="id" value={s.id as string} />
                        <input
                          type="text"
                          name="rejection_note"
                          placeholder="Reason (optional)"
                          className="border rounded px-2 py-1 text-xs w-28"
                        />
                        <button
                          type="submit"
                          className="ml-1 px-3 py-1 bg-red-700 text-white text-xs rounded"
                        >
                          Reject
                        </button>
                      </form>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
