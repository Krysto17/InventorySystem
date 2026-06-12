-- ─── Phase 10 (A): Real site names ───────────────────────────────────────────
-- Sites get their real names (the placeholder Site 1/2/3 seed in 0001 is
-- immutable; rename via UPDATE — everything references site_id, so this is
-- safe).
--
-- NOTE on the blueprint's "Auditor" role: the owner confirmed that the
-- Auditor, the Director, and the System Owner are all the SAME PERSON — the
-- existing `owner` role. No separate auditor role or draft-review chain is
-- created; the owner already holds every capability the blueprint assigns to
-- the auditor.

update public.sites set name = 'Dong'     where name = 'Site 1';
update public.sites set name = 'New-Site' where name = 'Site 2';
update public.sites set name = 'Old-Site' where name = 'Site 3';
