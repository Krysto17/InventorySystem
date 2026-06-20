import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { GateIntakeForm } from "./GateIntakeForm";

export default async function GateIntakePage() {
  const supabase = await createClient();
  const { data: materialTypes } = await supabase
    .from("material_types")
    .select("id, name")
    .eq("active", true)
    .order("name");

  return (
    <main className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-4 mb-4">
        <Link href="/gate" className="text-sm text-gray-500 hover:underline">← Gate</Link>
        <h1 className="text-2xl font-semibold">New visit intake</h1>
      </div>
      <GateIntakeForm materialTypes={(materialTypes ?? []) as { id: string; name: string }[]} />
    </main>
  );
}
