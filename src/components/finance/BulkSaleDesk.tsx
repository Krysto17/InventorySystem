import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";
import { getSites, getActiveMaterialTypes, type Ref } from "@/lib/reference";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ActionForm } from "@/components/ui/ActionForm";
import { formatNaira, formatWeight, formatTimestamp } from "@/lib/visits/format";
import { recordBulkSale, approveBulkSale, rejectBulkSale } from "@/lib/finance/sale-actions";
import { one as g1 } from "@/lib/db/relation";

const STATUS: Record<string, "yellow" | "green" | "red"> = {
  pending: "yellow", approved: "green", rejected: "red",
};

/**
 * Where a sale of material is recorded.
 *
 * This is the revenue side of the profit-and-loss statement, and it had no
 * home before: the cost-price workflow records what a batch COST, never what
 * it sold for, so there was no selling price anywhere in the system and profit
 * could not be worked out. The manager records the sale and the owner approves
 * it; approval is what makes it income and takes the weight out of stock.
 */
export async function BulkSaleDesk() {
  const me = await getProfile();
  const supabase = await createClient();
  const isOwner = me?.role === "owner";

  const [{ data: sales }, materials, sites] = await Promise.all([
    supabase.from("bulk_sales")
      .select(`id, site_id, buyer_name, buyer_phone, grade, weight, unit_price, total,
               received_amount, sold_at, approval_status, rejection_note,
               site:sites(name), material:material_types(name),
               by:profiles!bulk_sales_recorded_by_fkey(full_name)`)
      .order("sold_at", { ascending: false })
      .limit(50),
    getActiveMaterialTypes(),
    isOwner ? getSites() : Promise.resolve([]),
  ]);

  const rows = (sales ?? []) as Array<Record<string, unknown>>;
  const pending = rows.filter((s) => s.approval_status === "pending");
  const today = new Date().toISOString().slice(0, 10);

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="flex items-center gap-4">
        <Link href={isOwner ? "/owner" : "/manager"} className="text-sm text-gray-500 hover:underline">
          ← {isOwner ? "Dashboard" : "Pricing queue"}
        </Link>
        <h1 className="text-2xl font-bold">Bulk sales</h1>
        {pending.length > 0 && <Badge variant="yellow">{pending.length} awaiting approval</Badge>}
      </div>

      {!isOwner && (
        <Card>
          <CardHeader><h2 className="text-sm font-semibold">Record a sale</h2></CardHeader>
          <CardContent>
            <ActionForm action={recordBulkSale} className="grid gap-3 text-sm sm:grid-cols-2">
              <Field label="Buyer"><input name="buyer_name" required className={INPUT} /></Field>
              <Field label="Buyer phone (optional)"><input name="buyer_phone" className={INPUT} /></Field>
              <Field label="Material">
                <select name="material_type_id" required className={INPUT}>
                  {(materials as Ref[]).map((m) => (
                    <option key={m.id as string} value={m.id as string}>{m.name as string}</option>
                  ))}
                </select>
              </Field>
              <Field label="Grade (optional)"><input name="grade" className={INPUT} /></Field>
              <Field label="Weight sold (kg)">
                <input name="weight" inputMode="decimal" required placeholder="1000" className={INPUT} />
              </Field>
              <Field label="Price per kg (₦)">
                <input name="unit_price" inputMode="decimal" required placeholder="15000" className={INPUT} />
              </Field>
              <Field label="Date sold">
                <input type="date" name="sold_at" defaultValue={today} className={INPUT} />
              </Field>
              <Field label="Received so far (₦, optional)">
                <input name="received_amount" inputMode="decimal" className={INPUT} />
              </Field>
              <div className="sm:col-span-2">
                <button type="submit" className="rounded bg-black px-4 py-2 text-sm text-white">
                  Record sale
                </button>
                <p className="mt-2 text-xs text-ink-2">
                  The sale becomes income, and the weight leaves stock, only once the owner
                  approves it.
                </p>
              </div>
            </ActionForm>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><h2 className="text-sm font-semibold">Sales</h2></CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="px-4 py-3 text-sm text-ink-2">No sales recorded yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {rows.map((s) => {
                const status = String(s.approval_status);
                return (
                  <li key={s.id as string} className="px-4 py-3 text-sm">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <span>
                        <span className="font-medium">{s.buyer_name as string}</span>
                        <Badge variant={STATUS[status] ?? "default"}>{status}</Badge>
                        <span className="block text-xs text-ink-2">
                          {g1<{ name: string }>((s as { material: unknown }).material)?.name ?? "—"}
                          {s.grade ? ` · ${s.grade as string}` : ""}
                          {" · "}{formatWeight(Number(s.weight))}
                          {" @ "}{formatNaira(Number(s.unit_price))}/kg
                          {" · "}{g1<{ name: string }>((s as { site: unknown }).site)?.name ?? "—"}
                        </span>
                        <span className="block text-xs text-ink-2">
                          Sold {formatTimestamp(s.sold_at as string)} · recorded by{" "}
                          {g1<{ full_name: string }>((s as { by: unknown }).by)?.full_name ?? "—"}
                          {s.received_amount != null
                            ? ` · received ${formatNaira(Number(s.received_amount))}`
                            : ""}
                        </span>
                        {s.rejection_note
                          ? <span className="block text-xs text-reject">{s.rejection_note as string}</span>
                          : null}
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="font-semibold tabular-nums">{formatNaira(Number(s.total))}</span>
                        {isOwner && status === "pending" && (
                          <>
                            <ActionForm action={approveBulkSale}>
                              <input type="hidden" name="id" value={s.id as string} />
                              <button type="submit"
                                className="rounded bg-black px-3 py-1.5 text-xs text-white">Approve</button>
                            </ActionForm>
                            <ActionForm action={rejectBulkSale} data-confirm="Reject this sale?">
                              <input type="hidden" name="id" value={s.id as string} />
                              <button type="submit"
                                className="rounded border border-line px-3 py-1.5 text-xs">Reject</button>
                            </ActionForm>
                          </>
                        )}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {isOwner && sites.length > 0 && (
        <p className="text-xs text-ink-2">
          Sales are recorded by each site&rsquo;s manager. Approving one reduces that site&rsquo;s
          stock and counts the sale as income on the profit-and-loss statement.
        </p>
      )}
    </main>
  );
}

const INPUT = "rounded border border-line px-2 py-1.5";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wide text-ink-2">{label}</span>
      {children}
    </label>
  );
}
