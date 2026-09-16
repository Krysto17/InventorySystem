import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SupplierPicker } from "@/components/suppliers/SupplierPicker";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Stamp } from "@/components/ui/stamp";
import { formatTimestamp } from "@/lib/visits/format";
import { issueGatePass, cancelGatePass, authorizeGatePass } from "./actions";
import { ActionForm } from "@/components/ui/ActionForm";
import { GateMovementsCard } from "@/components/gate/GateMovementsCard";
import { requireGeneralManager } from "@/lib/auth/require-general-manager";

import { one as g1 } from "@/lib/db/relation";

const STATUS_VARIANT: Record<string, "default" | "green" | "yellow" | "red"> = {
  issued: "yellow", acknowledged: "green", cancelled: "red",
};

export default async function ManagerGatePassesPage() {
  const me = await requireGeneralManager();
  const supabase = await createClient();
  // A lot already on a live lot-linked pass cannot take another — 0155's
  // one-live-pass-per-lot index would refuse it — so it is not offered.
  const { data: claimed } = me.site_id
    ? await supabase.from("gate_passes").select("stock_lot_id")
        .eq("site_id", me.site_id).not("stock_lot_id", "is", null)
        .in("status", ["pending", "issued", "acknowledged"])
    : { data: null };
  const claimedLotIds = (claimed ?? []).map((c) => c.stock_lot_id as string);
  const [{ data: passes }, { data: suppliers }, { data: materialTypes }, { data: lots }] = await Promise.all([
    supabase.from("gate_passes")
      .select("id, pass_code, material_owner, reason, bags, weight_kg, status, issued_at, material:material_types(name), supplier:suppliers(name)")
      .order("issued_at", { ascending: false }).limit(30),
    // Seed suggestions only — SupplierPicker searches the database too, so this
    // cap does not decide who can be picked (it hid 119 of 319 suppliers).
    supabase.from("suppliers").select("id, name, supplier_code").order("name").limit(200),
    supabase.from("material_types").select("id, name").order("name"),
    // Own-site lots only. The GM reads every site's stock, but a manual pass may
    // only release material from the issuer's own site (issueGatePass refuses
    // any other), so offering other sites' lots just set up a refusal. The owner
    // has no site, so there is nothing to offer — and submitting says so.
    me.site_id
      ? supabase.from("stock_lots")
          .select("id, weight_kg, material:material_types(name), supplier:suppliers(name)")
          .eq("status", "available").eq("site_id", me.site_id)
          // The nil uuid keeps `in.()` well-formed when nothing is claimed.
          .not("id", "in", `(${claimedLotIds.length ? claimedLotIds.join(",") : "00000000-0000-0000-0000-000000000000"})`)
          .order("created_at", { ascending: false }).limit(200)
      : Promise.resolve({ data: null }),
  ]);

  return (
    <main className="p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/manager" className="text-sm text-gray-500 hover:underline">← Pricing queue</Link>
        <h1 className="text-2xl font-bold">Gate passes</h1>
      </div>

      <Card>
        <CardHeader><h2 className="text-sm font-semibold">Issue a gate pass (outgoing material)</h2></CardHeader>
        <CardContent>
          {/* ActionForm shows why a pass was not issued — no site on the account,
              a lot that has gone, another site's lot — instead of a silent reset. */}
          <ActionForm action={issueGatePass}>
          <div className="grid grid-cols-2 gap-3">
            <label className="col-span-2 text-xs font-medium">Release from stock lot (material leaves stock when the gate acknowledges)
              <select name="stock_lot_id" defaultValue="" className="mt-1 block w-full rounded border px-2 py-1 text-sm">
                <option value="">— not from a tracked lot —</option>
                {(lots ?? []).map((l) => {
                  const mat = g1<{ name: string }>((l as { material: unknown }).material);
                  const sup = g1<{ name: string }>((l as { supplier: unknown }).supplier);
                  return (
                    <option key={l.id as string} value={l.id as string}>
                      {mat?.name ?? "—"} · {l.weight_kg as number} kg{sup?.name ? ` · ${sup.name}` : ""}
                    </option>
                  );
                })}
              </select>
            </label>
            <SupplierPicker
              required={false}
              label="Supplier (or type owner below)"
              suppliers={(suppliers ?? []).map((s) => ({ id: s.id as string, name: s.name as string, code: (s.supplier_code as string | null) ?? null }))}
            />
            <label className="text-xs font-medium">Material owner (free text)
              <input type="text" name="material_owner" className="mt-1 block w-full rounded border px-2 py-1 text-sm" />
            </label>
            <label className="text-xs font-medium">Material type
              <select name="material_type_id" defaultValue="" className="mt-1 block w-full rounded border px-2 py-1 text-sm">
                <option value="">—</option>
                {(materialTypes ?? []).map((m) => <option key={m.id as string} value={m.id as string}>{m.name as string}</option>)}
              </select>
            </label>
            <label className="text-xs font-medium">Bags
              <input type="number" name="bags" min="0" className="mt-1 block w-full rounded border px-2 py-1 text-sm" />
            </label>
            <label className="text-xs font-medium">Weight (kg)
              <input type="number" name="weight_kg" min="0" step="0.001" className="mt-1 block w-full rounded border px-2 py-1 text-sm" />
            </label>
            <label className="text-xs font-medium">Reason
              <input type="text" name="reason" required className="mt-1 block w-full rounded border px-2 py-1 text-sm" />
            </label>
            <button type="submit" className="col-span-2 rounded bg-ore px-4 py-1.5 text-sm font-semibold text-white hover:bg-ore-strong">
              Issue gate pass
            </button>
          </div>
          </ActionForm>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><h2 className="text-sm font-semibold">Gate passes ({passes?.length ?? 0})</h2></CardHeader>
        <CardContent className="p-0">
          {(passes?.length ?? 0) === 0 ? (
            <p className="px-4 py-3 text-sm text-ink-2">No gate passes yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {(passes ?? []).map((p) => {
                const mat = g1<{ name: string }>((p as { material: unknown }).material);
                const sup = g1<{ name: string }>((p as { supplier: unknown }).supplier);
                const st = p.status as string;
                return (
                  <li key={p.id as string} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <Stamp>{p.pass_code as string}</Stamp>
                      <span>{sup?.name ?? p.material_owner ?? "—"} · {mat?.name ?? "—"} · {p.reason as string}</span>
                      <span className="text-ink-2">{formatTimestamp(p.issued_at as string)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={STATUS_VARIANT[st] ?? "default"}>{st}</Badge>
                      <a href={`/api/pdf/gate-pass/${p.id}`} target="_blank" rel="noreferrer"
                        className="rounded border border-line px-2.5 py-0.5 text-xs hover:bg-paper">🖨 80mm</a>
                      {/* Receiving unsettling a line raises the pass as PENDING
                          for a manager to authorise (unsettle_line). Without a
                          control here those requests simply stayed stuck — 14 of
                          them, the oldest from August. Dropping one is equally
                          allowed by the DB, so pending can be cancelled too. */}
                      {st === "pending" && (
                        <ActionForm action={authorizeGatePass}>
                          <input type="hidden" name="pass_id" value={p.id as string} />
                          <button type="submit" className="rounded bg-approve px-2.5 py-0.5 text-xs font-semibold text-white">
                            Authorise
                          </button>
                        </ActionForm>
                      )}
                      {(st === "issued" || st === "pending") && (
                        <ActionForm action={cancelGatePass}>
                          <input type="hidden" name="pass_id" value={p.id as string} />
                          <button type="submit" className="rounded border px-2.5 py-0.5 text-xs">Cancel</button>
                        </ActionForm>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <GateMovementsCard showSite />
    </main>
  );
}
