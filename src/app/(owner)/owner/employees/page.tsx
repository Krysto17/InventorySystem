import { createClient } from "@/lib/supabase/server";
import { ROLES } from "@/lib/auth/roles";
import { getProfile } from "@/lib/auth/get-profile";
import { AddEmployeeForm } from "./form";
import { EmployeeRow, type EmployeeRowData } from "./EmployeeRow";

const g1 = <T,>(v: unknown): T | null =>
  Array.isArray(v) ? ((v[0] ?? null) as T | null) : ((v ?? null) as T | null);

export default async function EmployeesPage() {
  const supabase = await createClient();
  const me = await getProfile();
  const [{ data: sites }, { data: people }] = await Promise.all([
    supabase.from("sites").select("id, name").order("name"),
    supabase
      .from("profiles")
      .select("id, full_name, username, role, status, site:sites(name)")
      .order("role"),
  ]);

  const employees: EmployeeRowData[] = (people ?? []).map((p) => ({
    id: p.id as string,
    full_name: p.full_name as string,
    username: p.username as string,
    role: p.role as string,
    site: g1<{ name: string }>((p as { site: unknown }).site)?.name ?? null,
    status: ((p as { status?: string }).status as "active" | "disabled") ?? "active",
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
          Disable an account to block sign-in without deleting it (their records stay intact);
          re-enable any time. A disabled user in an active session is signed out on their next action.
        </p>
        <ul className="divide-y divide-line rounded border">
          {employees.map((e) => <EmployeeRow key={e.id} e={e} isSelf={e.id === me?.id} />)}
        </ul>
      </section>
    </main>
  );
}
