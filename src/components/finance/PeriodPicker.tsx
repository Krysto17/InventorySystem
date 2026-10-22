/**
 * The statement's date window. A plain GET form on purpose: it needs no client
 * JavaScript, it leaves the chosen period in the URL so a statement can be
 * bookmarked or sent to someone, and the PDF link below reads the same two
 * values.
 */
export function PeriodPicker({
  action, from, to,
}: { action: string; from: string; to: string }) {
  return (
    <form method="get" action={action} data-confirm="skip"
      className="flex flex-wrap items-end gap-3 text-sm">
      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-ink-2">From</span>
        <input type="date" name="from" defaultValue={from}
          className="rounded border border-line px-2 py-1.5" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-ink-2">To</span>
        <input type="date" name="to" defaultValue={to}
          className="rounded border border-line px-2 py-1.5" />
      </label>
      <button type="submit" className="rounded bg-black px-4 py-2 text-sm text-white">
        Show
      </button>
      <a href={`/api/pdf/profit-loss?from=${from}&to=${to}`}
        className="rounded border border-line px-4 py-2 text-sm font-medium hover:bg-panel">
        Download statement (PDF)
      </a>
    </form>
  );
}
