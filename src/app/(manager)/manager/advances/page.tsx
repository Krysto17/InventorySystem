import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Stamp } from "@/components/ui/stamp";
import { formatTimestamp } from "@/lib/visits/format";
import { setAdvanceApproval, deleteAdvance } from "./actions";
import { AdvanceForm } from "@/components/advances/AdvanceForm";
import { AdvanceEditForm } from "@/components/advances/AdvanceEditForm";

import { one as g1 } from "@/lib/db/relation";
const ngn = (n: number) => `₦${n.toLocaleString()}`;

export default async function ManagerAdvancesPage() {
  const me = await getProfile();
  const isOwner = me?.role === "owner";
  const canManage = me?.role === "manager" || isOwner;
  const supabase = await createClient();

  const { data: suppliers } = await supabase
    .from("suppliers").select("id, name, supplier_code").order("name").limit(300);

  const { data: advances } = await supabase
    .from("advances")
    .select(`
      id, purpose, amount_naira, approval_status, created_at, comment, account_number, account_name, bank_name,
      supplier:suppliers(name, supplier_code)
    `)
    .order("created_at", { ascending: false })
    .limit(40);

  return (
    <main className="p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/manager" className="text-sm text-gray-500 hover:underline">← Pricing queue</Link>
        <h1 className="text-2xl font-bold">Supplier advances</h1>
      </div>

      <Card>
        <CardHeader><h2 className="text-sm font-semibold">Record an advance</h2></CardHeader>
        <CardContent>
          <AdvanceForm suppliers={(suppliers ?? []).map((s) => ({ id: s.id as string, name: s.name as string, code: (s.supplier_code as string | null) ?? null }))} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><h2 className="text-sm font-semibold">Advances ({advances?.length ?? 0})</h2></CardHeader>
        <CardContent className="p-0">
          {(advances?.length ?? 0) === 0 ? (
            <p className="px-4 py-3 text-sm text-gray-500">No advances recorded.</p>
          ) : (
            <ul className="divide-y divide-line">
              {(advances ?? []).map((a) => {
                const sup = g1<{ name: string; supplier_code: string | null }>((a as { supplier: unknown }).supplier);
                const st = a.approval_status as string;
                return (
                  <li key={a.id as string} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                    <div className="text-sm">
                      <div className="flex items-center gap-2">
                        <strong>{sup?.name ?? "—"}</strong>
                        {sup?.supplier_code && <Stamp>{sup.supplier_code}</Stamp>}
                      </div>
                      <div className="text-xs text-gray-500">
                        {a.purpose as string} · {formatTimestamp(a.created_at as string)}
                      </div>
                      {(a.account_number || a.account_name || a.bank_name) && (
                        <div className="text-xs text-gray-500">
                          {(a.account_name as string | null) ?? "—"} · <span className="mono">{(a.account_number as string | null) ?? "—"}</span> · {(a.bank_name as string | null) ?? "—"}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{ngn(Number(a.amount_naira))}</span>
                      <Badge variant={st === "approved" ? "green" : st === "rejected" ? "red" : "yellow"}>{st}</Badge>
                      {isOwner && st === "pending" && (
                        <>
                          <form action={setAdvanceApproval}>
                            <input type="hidden" name="advance_id" value={a.id as string} />
                            <input type="hidden" name="decision" value="approved" />
                            <button type="submit" className="rounded bg-approve px-2.5 py-0.5 text-xs text-white">Approve</button>
                          </form>
                          <form action={setAdvanceApproval}>
                            <input type="hidden" name="advance_id" value={a.id as string} />
                            <input type="hidden" name="decision" value="rejected" />
                            <button type="submit" className="rounded border px-2.5 py-0.5 text-xs">Reject</button>
                          </form>
                        </>
                      )}
                      {/* Manager/owner may delete an advance before it is paid. */}
                      {canManage && st !== "paid" && (
                        <form action={deleteAdvance}>
                          <input type="hidden" name="advance_id" value={a.id as string} />
                          <button type="submit" className="rounded border border-reject px-2.5 py-0.5 text-xs text-reject hover:bg-reject-soft">Delete</button>
                        </form>
                      )}
                    </div>
                    {/* Manager/owner may edit an advance before it is paid. */}
                    {canManage && st !== "paid" && (
                      <div className="w-full">
                        <AdvanceEditForm
                          id={a.id as string}
                          purpose={a.purpose as string}
                          amount={Number(a.amount_naira)}
                          comment={(a.comment as string | null) ?? null}
                          accountName={(a.account_name as string | null) ?? null}
                          accountNumber={(a.account_number as string | null) ?? null}
                          bankName={(a.bank_name as string | null) ?? null}
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
