-- Seeds the four remaining demo brand workspaces.
--
-- Kopi Senja Nusantara already exists (0002); this adds Batik Lestari, Rumah
-- Rajut, Jamu Alami, and Kriya Bali so each has its own client row, its own
-- memberships, and its own ad_accounts mapping. Every brand is fictional. Rows
-- are keyed by slug and inserted with `on conflict do nothing`, so re-running
-- this migration changes nothing.
--
-- No platform account identifier appears here. `ad_accounts.account_key` is the
-- opaque internal key the schema comment requires; real Google customer ids and
-- Meta ad account ids belong in the deployment environment, never in this
-- repository.

insert into public.clients (slug, display_name)
values
  ('batik-lestari', 'Batik Lestari'),
  ('rumah-rajut', 'Rumah Rajut'),
  ('jamu-alami', 'Jamu Alami'),
  ('kriya-bali', 'Kriya Bali')
on conflict (slug) do nothing;

-- Whoever administers the pilot workspace administers the demo brands too.
-- Membership is copied from the pilot's admins rather than from hardcoded
-- emails or uuids, so this migration is portable to any fresh project and
-- carries no personal identity.
insert into public.client_memberships (user_id, client_id, role, is_active)
select u.id, c.id, 'admin'::public.app_role, true
from public.app_users u
join public.client_memberships pilot_membership
  on pilot_membership.user_id = u.id
  and pilot_membership.role = 'admin'
  and pilot_membership.is_active
join public.clients pilot
  on pilot.id = pilot_membership.client_id
  and pilot.slug = 'kopi-senja'
cross join public.clients c
where c.slug in (
    'batik-lestari',
    'rumah-rajut',
    'jamu-alami',
    'kriya-bali'
  )
on conflict (user_id, client_id) do nothing;

-- One ad_accounts row per brand per platform that brand actually runs, matching
-- ACCOUNT_OPTIONS in src/lib/dashboard/accounts.ts. Batik Lestari and Rumah
-- Rajut run Google only; Jamu Alami and Kriya Bali run both.
--
-- Currency and timezone are starting points, not verified truth. The first live
-- sync overwrites them with what the platform itself reports, and the
-- data-quality gate judges the stored values, not these seeds.
insert into public.ad_accounts (
  client_id,
  platform,
  account_key,
  display_name,
  currency,
  account_timezone,
  attribution_setting_snapshot,
  is_active
)
select
  c.id,
  seed.platform::public.ad_platform,
  seed.platform || '-live-v1',
  c.display_name || ' ' || seed.platform || ' account',
  seed.currency,
  seed.account_timezone,
  jsonb_build_object('status', 'seeded-awaiting-first-sync'),
  true
from public.clients c
join (
  values
    ('batik-lestari', 'google', 'USD', 'Asia/Jakarta'),
    ('rumah-rajut', 'google', 'USD', 'Asia/Jakarta'),
    ('jamu-alami', 'google', 'USD', 'Asia/Jakarta'),
    ('jamu-alami', 'meta', 'USD', 'Asia/Jakarta'),
    ('kriya-bali', 'google', 'USD', 'Asia/Makassar'),
    ('kriya-bali', 'meta', 'USD', 'Asia/Makassar')
) as seed(slug, platform, currency, account_timezone)
  on seed.slug = c.slug
on conflict (client_id, platform, account_key) do nothing;
