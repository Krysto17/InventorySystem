import { createClient } from "@/lib/supabase/server";
import { createMachine, updateMachine } from "./actions";

export default async function MachinesPage() {
  const supabase = await createClient();
  const { data: sites } = await supabase.from("sites").select("id, name").order("name");
  const { data: machines } = await supabase
    .from("machines")
    .select("id, name, charge_basis, rate, active, site:sites(name)")
    .order("name");

  return (
    <main className="p-6 max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-semibold">Machines</h1>

      <form action={createMachine} className="border rounded p-3 grid grid-cols-2 gap-2">
        <select name="site_id" required className="border rounded px-2 py-1">
          <option value="">— site —</option>
          {(sites ?? []).map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <input
          name="name"
          required
          placeholder="Machine name"
          className="border rounded px-2 py-1"
        />
        <select name="charge_basis" required className="border rounded px-2 py-1">
          <option value="weight">weight (kg)</option>
          <option value="bag">bag</option>
          <option value="hour">hour</option>
        </select>
        <input
          name="rate"
          type="number"
          step="0.01"
          min="0"
          required
          placeholder="₦ rate"
          className="border rounded px-2 py-1"
        />
        <button type="submit" className="col-span-2 px-3 py-2 bg-black text-white rounded">
          Add machine
        </button>
      </form>

      <table className="w-full border rounded text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="p-2 text-left">Site</th>
            <th className="p-2 text-left">Name</th>
            <th className="p-2 text-left">Basis</th>
            <th className="p-2 text-right">Rate</th>
            <th className="p-2"></th>
          </tr>
        </thead>
        <tbody>
          {(machines ?? []).map((m) => {
            const site = m.site as unknown as { name?: string } | null;
            return (
              <tr
                key={m.id}
                className={`border-t ${m.active ? "" : "text-gray-400 line-through"}`}
              >
                <td className="p-2">{site?.name ?? "—"}</td>
                <td className="p-2">{m.name}</td>
                <td className="p-2">{m.charge_basis}</td>
                <td className="p-2 text-right">₦{m.rate}</td>
                <td className="p-2 text-right">
                  <form action={updateMachine}>
                    <input type="hidden" name="id" value={m.id} />
                    <input
                      type="hidden"
                      name="active"
                      value={m.active ? "false" : "true"}
                    />
                    <button type="submit" className="text-xs underline">
                      {m.active ? "Disable" : "Enable"}
                    </button>
                  </form>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </main>
  );
}
