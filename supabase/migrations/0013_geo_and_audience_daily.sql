-- Geography and audience segment performance, one row per targeting slice per
-- day.
--
-- Two tables rather than one: a location and an audience segment are different
-- kinds of key, and a shared table would need a nullable column per kind and a
-- check constraint to keep them apart. That is the shape that lets a bad pull
-- write a half-row nobody notices.
--
-- GEOGRAPHY GRAIN — country and region only, city deliberately excluded.
--
-- `user_location_view` segments multiply: one campaign-day becomes
-- country x region x city rows, and the city tail is long and mostly empty.
-- A year of campaign-grain rows across a handful of brands is already in the
-- thousands; a city grain would put this table into the millions for a cut
-- nobody reads at that depth. Country and region answer the question the
-- dashboard actually asks — which markets pay for themselves — and the city
-- level can be added later as its own table without rewriting this one.
--
-- `user_location_view` and not `geographic_view`. The first is where the user
-- physically was; the second mixes physical location with location of interest.
-- For brands selling across borders those are different populations, and
-- averaging them produces a market report that describes neither.
--
-- AUDIENCE GRAIN — ad group criterion, which is where Google reports it.
--
-- `ad_group_audience_view` reports a segment as it is attached to an ad group,
-- so the same remarketing list appearing in three ad groups is three rows. They
-- are kept separate: the list is not the unit of decision, the list-in-this-ad-
-- group is, and summing them would double count a user reached twice.
--
-- Null conversion columns mean "not measured" in both tables, exactly as in
-- `ad_search_term_daily`. They must never be read as zero.

create table public.ad_geo_daily (
  id uuid primary key default gen_random_uuid(),
  metric_date date not null,
  client_id uuid not null references public.clients(id) on delete restrict,
  account_id uuid not null,
  platform public.ad_platform not null default 'google'
    check (platform = 'google'),
  campaign_key text not null check (campaign_key <> ''),
  -- Google geo target constant ids, stored as text because they arrive as
  -- resource names and a numeric cast would lose a malformed value silently.
  country_criterion_id text not null check (country_criterion_id <> ''),
  -- Empty string, not null, when Google reported no region for the row: the
  -- grain key has to stay non-null, and "no region" is a real answer for
  -- traffic Google could only place to a country.
  region_criterion_id text not null default '',
  country_code text,
  region_name text,
  currency text not null,
  account_timezone text not null,
  spend numeric(18, 6) not null default 0 check (spend >= 0),
  impressions bigint not null default 0 check (impressions >= 0),
  clicks bigint not null default 0 check (clicks >= 0),
  registrations numeric(18, 6) check (registrations >= 0),
  purchases numeric(18, 6) check (purchases >= 0),
  order_conversion_value numeric(18, 6) check (order_conversion_value >= 0),
  conversion_action_filtered boolean not null default false,
  source_connector text not null,
  source_query_version text not null,
  synced_at timestamptz not null,
  is_provisional boolean not null default false,
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ad_geo_daily_account_client_fkey
    foreign key (account_id, client_id)
    references public.ad_accounts (id, client_id)
    on delete restrict,
  constraint ad_geo_daily_grain_key unique (
    metric_date,
    account_id,
    campaign_key,
    country_criterion_id,
    region_criterion_id,
    source_query_version
  )
);

create index ad_geo_daily_client_date_idx
  on public.ad_geo_daily (client_id, metric_date);

create index ad_geo_daily_country_idx
  on public.ad_geo_daily (client_id, country_criterion_id, metric_date);

alter table public.ad_geo_daily enable row level security;

revoke all on table public.ad_geo_daily from anon, authenticated;
grant select on table public.ad_geo_daily to authenticated;

create policy ad_geo_daily_select_member
  on public.ad_geo_daily for select
  to authenticated
  using (public.can_access_client(client_id));

comment on table public.ad_geo_daily is
  'Google performance by physical user location at country and region grain, per brand per day per campaign. City is deliberately excluded: the row count grows with the long tail without answering a question the dashboard asks. Read from user_location_view, not geographic_view, so location of interest is never mixed with where the user was. Written by the service role only.';
comment on column public.ad_geo_daily.region_criterion_id is
  'Empty string when Google placed the traffic to a country but not a region. That is a real answer, not a missing one.';

create table public.ad_audience_daily (
  id uuid primary key default gen_random_uuid(),
  metric_date date not null,
  client_id uuid not null references public.clients(id) on delete restrict,
  account_id uuid not null,
  platform public.ad_platform not null default 'google'
    check (platform = 'google'),
  campaign_key text not null check (campaign_key <> ''),
  -- The same segment attached to two ad groups is two rows on purpose.
  ad_group_key text not null check (ad_group_key <> ''),
  criterion_id text not null check (criterion_id <> ''),
  -- What kind of segment this is: user list, in-market, affinity, custom.
  -- Carried because a remarketing list and an in-market segment are not
  -- comparable audiences, however similar their metrics look.
  criterion_type text,
  display_name text,
  currency text not null,
  account_timezone text not null,
  spend numeric(18, 6) not null default 0 check (spend >= 0),
  impressions bigint not null default 0 check (impressions >= 0),
  clicks bigint not null default 0 check (clicks >= 0),
  registrations numeric(18, 6) check (registrations >= 0),
  purchases numeric(18, 6) check (purchases >= 0),
  order_conversion_value numeric(18, 6) check (order_conversion_value >= 0),
  conversion_action_filtered boolean not null default false,
  source_connector text not null,
  source_query_version text not null,
  synced_at timestamptz not null,
  is_provisional boolean not null default false,
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ad_audience_daily_account_client_fkey
    foreign key (account_id, client_id)
    references public.ad_accounts (id, client_id)
    on delete restrict,
  constraint ad_audience_daily_grain_key unique (
    metric_date,
    account_id,
    ad_group_key,
    criterion_id,
    source_query_version
  )
);

create index ad_audience_daily_client_date_idx
  on public.ad_audience_daily (client_id, metric_date);

create index ad_audience_daily_campaign_idx
  on public.ad_audience_daily (client_id, campaign_key, metric_date);

alter table public.ad_audience_daily enable row level security;

revoke all on table public.ad_audience_daily from anon, authenticated;
grant select on table public.ad_audience_daily to authenticated;

create policy ad_audience_daily_select_member
  on public.ad_audience_daily for select
  to authenticated
  using (public.can_access_client(client_id));

comment on table public.ad_audience_daily is
  'Google audience segment performance per brand per day, at the ad group criterion grain Google reports it. The same list in two ad groups is two rows: summing them would double count a user reached twice. Written by the service role only.';
comment on column public.ad_audience_daily.criterion_type is
  'user_list, in_market, affinity or custom. A remarketing list and an in-market segment are not comparable audiences however similar their metrics look.';
