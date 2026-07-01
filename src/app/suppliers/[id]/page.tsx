import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SupplierEditForms } from "@/components/suppliers/SupplierEditForms";

type FormerAccount = { account_name?: string | null; account_number?: string | null; bank_name?: string | null; replaced_at?: string };

export default async function SupplierDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getProfile();
  if (!me) redirect("/login");

  const supabase = await createClient();
  const { data: s } = await supabase
    .from("suppliers")
    .select("id, name, phone, supplier_code, former_names, former_accounts, account_name, account_number, bank_name, created_at")
    .eq("id", id)
    .maybeSingle();
  if (!s) notFound();

  const formerNames = (s.former_names as string[] | null) ?? [];
  const formerAccounts = (s.former_accounts as FormerAccount[] | null) ?? [];
  const canEdit = me.role === "manager" || me.role === "owner";

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-center gap-3">
        <Link href="/suppliers" className="text-sm text-gray-500 hover:underline">← Suppliers</Link>
        <h1 className="text-2xl font-bold">{s.name as string}</h1>
        <Badge variant="blue">{(s.supplier_code as string | null) ?? "no code"}</Badge>
      </div>

      <Card>
        <CardHeader><h2 className="text-sm font-semibold">Profile</h2></CardHeader>
        <CardContent className="space-y-1 text-sm">
          <div>Phone: {(s.phone as string | null) ?? "—"}</div>
          {formerNames.length > 0 && <div className="text-gray-500">Previous names: {formerNames.join(", ")}</div>}
        </CardContent>
      </Card>

      {canEdit && (
        <Card>
          <CardHeader><h2 className="text-sm font-semibold">Edit supplier</h2></CardHeader>
          <CardContent>
            <SupplierEditForms
              supplier={{
                id: s.id as string,
                name: s.name as string,
                account_name: (s.account_name as string | null) ?? null,
                account_number: (s.account_number as string | null) ?? null,
                bank_name: (s.bank_name as string | null) ?? null,
              }}
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><h2 className="text-sm font-semibold">Account details</h2></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="rounded border border-line p-2">
            <div className="text-[11px] font-medium text-ink-2">Current</div>
            {s.account_number ? (
              <div>{(s.account_name as string | null) ?? "—"} · <span className="mono">{s.account_number as string}</span> · {(s.bank_name as string | null) ?? "—"}</div>
            ) : (
              <div className="text-gray-500">No account details on file.</div>
            )}
          </div>
          {formerAccounts.length > 0 && (
            <div>
              <div className="text-[11px] font-medium text-ink-2">Previous accounts ({formerAccounts.length})</div>
              <ul className="mt-1 space-y-1">
                {formerAccounts.slice().reverse().map((a, i) => (
                  <li key={i} className="rounded bg-zinc-50 px-2 py-1 text-xs text-gray-600 dark:bg-zinc-800/50">
                    {a.account_name ?? "—"} · <span className="mono">{a.account_number ?? "—"}</span> · {a.bank_name ?? "—"}
                    {a.replaced_at && <span className="text-gray-400"> · until {new Date(a.replaced_at).toLocaleDateString()}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
