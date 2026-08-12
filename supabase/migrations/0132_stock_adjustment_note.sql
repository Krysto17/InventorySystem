-- ─── A manual stock correction says why ─────────────────────────────────────
-- The owner's adjustment form asks for a reason ("recount, spoilage") and the
-- action read it and threw it away — there was nowhere to put it. An unexplained
-- correction to the stock ledger is exactly the kind of entry someone has to
-- account for later, more so now the store keeper raises disputes against it.

alter table public.stock_movements
  add column if not exists note text;

comment on column public.stock_movements.note is
  'Why a manual adjustment was made — recount, spoilage, correction of a dispute.';

grant update (note) on public.stock_movements to authenticated;
