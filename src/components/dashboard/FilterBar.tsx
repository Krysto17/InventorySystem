"use client";

import { useRouter } from "next/navigation";

type Site = { id: string; name: string };

export function FilterBar({
  sites,
  currentSiteId,
  currentFrom,
  currentTo,
}: {
  sites: Site[];
  currentSiteId: string;
  currentFrom: string;
  currentTo: string;
}) {
  const router = useRouter();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const params = new URLSearchParams();
    const siteId = String(fd.get("site_id") ?? "");
    const from   = String(fd.get("from")    ?? "");
    const to     = String(fd.get("to")      ?? "");
    if (siteId) params.set("site_id", siteId);
    if (from)   params.set("from", from);
    if (to)     params.set("to", to);
    router.push(`/owner?${params.toString()}`);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-wrap gap-3 items-end text-sm"
    >
      <label className="flex flex-col gap-1">
        <span className="text-xs text-gray-500 uppercase tracking-wide">Site</span>
        <select
          name="site_id"
          defaultValue={currentSiteId}
          className="border rounded px-2 py-1.5 bg-white text-sm min-w-[120px]"
        >
          <option value="">All sites</option>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-gray-500 uppercase tracking-wide">From</span>
        <input
          type="date"
          name="from"
          defaultValue={currentFrom}
          className="border rounded px-2 py-1.5 bg-white text-sm"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-gray-500 uppercase tracking-wide">To</span>
        <input
          type="date"
          name="to"
          defaultValue={currentTo}
          className="border rounded px-2 py-1.5 bg-white text-sm"
        />
      </label>

      <button
        type="submit"
        className="px-4 py-1.5 bg-black text-white rounded text-sm"
      >
        Apply
      </button>

      <a
        href="/owner"
        className="px-3 py-1.5 border rounded text-sm text-gray-600 hover:bg-gray-50"
      >
        Reset
      </a>
    </form>
  );
}
