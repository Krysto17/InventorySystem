-- ─── Seed: permanent known logins ───────────────────────────────────────────
-- Runs on every `npx supabase db reset`. Provisions one stable account per role
-- so the app always has working logins (the test suite creates its own
-- ephemeral users; this guarantees a clean, known set after a reset).
--
-- All accounts use password: test-password-123
-- Login is by username (mapped to <username>@magneticjoezion.local).
-- Owner is cross-site; every other role is pinned to the Dong site.

do $$
declare
  dom  text := 'magneticjoezion.local';
  pw   text := extensions.crypt('test-password-123', extensions.gen_salt('bf'));
  dong uuid;
  rec  record;
  uid  uuid;
  mail text;
begin
  select id into dong from public.sites where name = 'Dong' limit 1;

  for rec in
    select * from (values
      ('owner1', 'System Owner',     'owner',      null::uuid),
      ('proc1',  'Processing One',   'processing', dong),
      ('recv1',  'Receiving One',    'receiving',  dong),
      ('qc1',    'Quality One',      'qc',         dong),
      ('mgr1',   'Manager One',      'manager',    dong),
      ('acct1',  'Accountant One',   'accounting', dong),
      ('inv1',   'Inventory One',    'inventory',  dong)
    ) as t(username, full_name, role, site_id)
  loop
    mail := rec.username || '@' || dom;
    if not exists (select 1 from auth.users where email = mail) then
      uid := gen_random_uuid();

      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, created_at, updated_at,
        raw_app_meta_data, raw_user_meta_data, is_super_admin
      ) values (
        '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
        mail, pw, now(), now(), now(),
        '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false
      );

      insert into auth.identities (
        provider_id, user_id, identity_data, provider, created_at, updated_at, last_sign_in_at
      ) values (
        uid::text, uid,
        jsonb_build_object('sub', uid::text, 'email', mail, 'email_verified', true),
        'email', now(), now(), now()
      );

      insert into public.profiles (id, full_name, username, role, site_id, must_change_password)
      values (uid, rec.full_name, rec.username, rec.role::public.app_role, rec.site_id, false);
    end if;
  end loop;
end $$;
