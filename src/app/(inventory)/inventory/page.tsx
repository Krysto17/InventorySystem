import { getProfile } from "@/lib/auth/get-profile";

export default async function InventoryPage() {
  const profile = await getProfile();
  return (
    <main className="p-6">
      <h1 className="text-xl font-semibold">Inventory Manager</h1>
      <p className="text-sm text-gray-600">
        Signed in as {profile?.full_name} ({profile?.username})
      </p>
    </main>
  );
}
