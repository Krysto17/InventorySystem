import { createClient } from "@/lib/supabase/server";
import { ROLES } from "@/lib/auth/roles";
import { AddEmployeeForm } from "./form";
import { EmployeeRow, type EmployeeRowData } from "./EmployeeRow";

const g1 = <T,>(v: unknown): T | null =>
  Array.isArray(v) ? ((v[0] ?? null) as T | null) : ((v ?? null) as T | null);

export default async function EmployeesPage() {
  const supabase = await createClient();
  const [{ data: sites }, { data: people }] = await Promise.all([
    supabase.from("sites").select("id, name").order("name"),
    supabase
      .from("profiles")
      .select("id, full_name, username, role, must_change_password, site:sites(name)")
      .order("role"),
  ]);

  const employees: EmployeeRowData[] = (people ?? []).map((p) => ({
    id: p.id as string,
    full_name: p.full_name as string,
    username: p.username as string,
    role: p.role as string,
    site: g1<{ name: string }>((p as { site: unknown }).site)?.name ?? null,
    must_change_password: !!(p as { must_change_password?: boolean }).must_change_password,
  }));

  return (
    <main className="mx-auto max-w-2xl space-y-8 p-6">
      <section>
        <h1 className="mb-4 text-xl font-semibold">Add employee</h1>
        <AddEmployeeForm sites={sites ?? []} roles={[...ROLES]} />
      </section>

      <section>
        <h2 className="mb-1 text-xl font-semibold">Employees ({employees.length})</h2>
        <p className="mb-3 text-sm text-zinc-500">
          Forgot a password? Reset it here — passwords can&apos;t be looked up, only replaced. A new
          one-time temp password is shown once; send it over WhatsApp and the user changes it on next login.
        </p>
        <ul className="divide-y divide-line rounded border">
          {employees.map((e) => <EmployeeRow key={e.id} e={e} />)}
        </ul>
      </section>
    </main>
  );
}
