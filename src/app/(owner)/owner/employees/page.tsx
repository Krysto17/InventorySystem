import { createClient } from "@/lib/supabase/server";
import { ROLES } from "@/lib/auth/roles";
import { AddEmployeeForm } from "./form";

export default async function EmployeesPage() {
  const supabase = await createClient();
  const { data: sites } = await supabase.from("sites").select("id, name").order("name");
  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="mb-4 text-xl font-semibold">Add Employee</h1>
      <AddEmployeeForm sites={sites ?? []} roles={[...ROLES]} />
    </main>
  );
}
