import { createClient } from "@/lib/supabase/server";
import { createMaterialType, toggleMaterialType } from "./actions";

export default async function MaterialTypesPage() {
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("material_types")
    .select("id, name, active")
    .order("name");

  return (
    <main className="p-6 max-w-2xl mx-auto space-y-6">
      <h1 className="text-2xl font-semibold">Material types</h1>

      <form action={createMaterialType} className="flex gap-2">
        <input
          name="name"
          required
          placeholder="New material name"
          className="flex-1 border rounded px-3 py-2"
        />
        <button type="submit" className="px-3 py-2 bg-black text-white rounded">
          Add
        </button>
      </form>

      <ul className="border rounded divide-y">
        {(rows ?? []).map((r) => (
          <li key={r.id} className="flex items-center justify-between px-3 py-2">
            <span className={r.active ? "" : "text-gray-400 line-through"}>{r.name}</span>
            <form action={toggleMaterialType}>
              <input type="hidden" name="id" value={r.id} />
              <input type="hidden" name="active" value={r.active ? "false" : "true"} />
              <button type="submit" className="text-sm underline">
                {r.active ? "Disable" : "Enable"}
              </button>
            </form>
          </li>
        ))}
      </ul>
    </main>
  );
}
