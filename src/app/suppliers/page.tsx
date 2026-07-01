import { getProfile } from "@/lib/auth/get-profile";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SupplierSearchList, type SupplierListRow } from "@/components/suppliers/SupplierSearchList";

// Shared supplier directory, searchable by every role (#4).
export default async function SuppliersPage() {
  const me = await getProfile();
  if (!me) redirect("/login");

  const supabase = await createClient();
  const { data } = await supabase
    .from("suppliers")
    .select("id, name, phone, supplier_code, former_names")
    .order("name");

  const suppliers: SupplierListRow[] = (data ?? []).map((s) => ({
    id: s.id as string,
    name: (s.name as string) ?? "—",
    phone: (s.phone as string | null) ?? null,
    code: (s.supplier_code as string | null) ?? null,
    formerNames: Array.isArray(s.former_names) ? (s.former_names as string[]) : [],
  }));

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-bold">Suppliers</h1>
        <p className="text-sm text-gray-500">{suppliers.length} suppliers — search across all sites.</p>
      </header>
      <SupplierSearchList suppliers={suppliers} />
    </main>
  );
}
