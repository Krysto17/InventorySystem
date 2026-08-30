// The analyses sheet is the heaviest read the QC analyst makes. Without this
// the browser sat on the previous screen with no feedback while it waited,
// which is indistinguishable from the page never loading.
export default function Loading() {
  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold">My analyses</h1>
        <p className="text-sm text-gray-500">Loading your analyses…</p>
      </header>
      <div className="rounded-lg border">
        <div className="border-b px-4 py-3">
          <div className="h-4 w-40 animate-pulse rounded bg-gray-200" />
        </div>
        <div className="space-y-3 p-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-4 w-full animate-pulse rounded bg-gray-100" />
          ))}
        </div>
      </div>
    </main>
  );
}
