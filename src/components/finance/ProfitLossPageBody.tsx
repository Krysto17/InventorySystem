import { ProfitLossStatement } from "@/components/finance/ProfitLossStatement";
import { PeriodPicker } from "@/components/finance/PeriodPicker";
import { fetchProfitLoss, defaultFrom, defaultTo } from "@/lib/finance/profit-loss";

/**
 * The statement screen, shared by the owner and the accountant so the two can
 * never drift apart and quote different profit for the same month.
 */
export async function ProfitLossPageBody({
  basePath, params,
}: {
  basePath: string;
  params: Record<string, string | string[] | undefined>;
}) {
  const from = String(params.from ?? defaultFrom());
  const to = String(params.to ?? defaultTo());

  // A backwards window would silently return zeros and read as "we made
  // nothing", which is worse than saying the dates are the wrong way round.
  if (from > to) {
    return (
      <div className="space-y-4">
        <PeriodPicker action={basePath} from={from} to={to} />
        <p className="rounded border border-reject/40 bg-reject/5 px-4 py-3 text-sm">
          The start date is after the end date, so there is no period to report on.
        </p>
      </div>
    );
  }

  const rows = await fetchProfitLoss(from, to);

  return (
    <div className="space-y-6">
      <PeriodPicker action={basePath} from={from} to={to} />
      <ProfitLossStatement rows={rows} from={from} to={to} />
    </div>
  );
}
