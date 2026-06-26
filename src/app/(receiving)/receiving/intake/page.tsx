import { createClient } from "@/lib/supabase/server";
// Reuse the shared intake form; receiving creates pre-processed visits only (#3).
import { IntakeForm } from "@/app/(processing)/processing/intake/IntakeForm";

export default async function ReceivingIntakePage() {
  const supabase = await createClient();
  const { data: materialTypes } = await supabase
    .from("material_types")
    .select("id, name")
    .eq("active", true)
    .order("name");

  return (
    <main className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-semibold mb-4">New processed intake</h1>
      <IntakeForm
        materialTypes={(materialTypes ?? []) as { id: string; name: string }[]}
        entryPath="processed"
      />
    </main>
  );
}
