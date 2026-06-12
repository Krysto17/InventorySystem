-- ─── Phase 10 (A+B): Real site names + auditor role ─────────────────────────
-- Sites get their real names (the placeholder Site 1/2/3 seed in 0001 is
-- immutable; rename via UPDATE — everything references site_id, so this is
-- safe). The 8th role `auditor` is added here and first USED by later
-- migrations (own transaction, so the new-enum-value restriction is fine),
-- mirroring how 0018 added 'qc'.

update public.sites set name = 'Dong'     where name = 'Site 1';
update public.sites set name = 'New-Site' where name = 'Site 2';
update public.sites set name = 'Old-Site' where name = 'Site 3';

alter type public.app_role add value if not exists 'auditor' after 'inventory';
