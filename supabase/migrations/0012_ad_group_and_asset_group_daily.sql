-- Ad group and asset group performance, one row per entity per day.
--
-- Why not `daily_metrics` with a new `entity_level`. Its grain key would accept
-- these rows — (metric_date, platform, account_id, entity_level, entity_key,
-- source_query_version) is wide enough — but the table carries no parent key.
-- An ad group row there could not name the campaign it belongs to, so the
-- breakdown could neither roll up to the campaign table nor drill down from it,
-- and `entity_name_snapshot` alone does not survive a rename. Campaign and ad
-- group are a hierarchy, and the hierarchy has to be stored, not inferred.
--
-- Why one table for both levels. An ad group (Search, Display, Shopping) and an
-- asset group (Performance Max) answer the same question at the same grain: how
-- did one slice of a campaign perform on one day. Splitting them would duplicate
-- every reader for no gain. `entity_level` separates them where it matters,
-- because they are NOT interchangeable:
--
--   * An ad group supports per-conversion-action segmentation, so its
--     conversions can be filtered to the actions this dashboard counts as
--     orders. That filtering is mandatory: an account can carry several
--     conversion actions categorised as PURCHASE whose counts differ by an
--     order of magnitude, so an unfiltered `metrics.conversions` is not a
--     number anyone may act on.
--   * An asset group does not. Performance Max reports asset group metrics
--     without that segmentation, so `purchases` here is whatever the pull could
--     attribute and `conversion_action_filtered` records which of the two it is.
--     A reader that treats the two as the same basis will compare a filtered
--     count against an unfiltered one.
--
-- Null conversion columns mean "not measured", exactly as in
-- `ad_search_term_daily`. They must never be read as zero.

create table public.ad_entity_daily (
  id uuid primary key default gen_random_uuid(),
  metric_date date not null,
  client_id uuid not null references public.clients(id) on delete restrict,
  account_id uuid not null,
  platform public.ad_platform not null default 'google'
    check (platform = 'google'),
  entity_level text not null check (entity_level in ('ad_group', 'asset_group')),
  -- The parent campaign, matching `ad_campaigns.campaign_key`. Never empty:
  -- an ad group without a campaign is not a row anyone can read.
  campaign_key text not null check (campaign_key <> ''),
  -- Google ad group id or asset group id, matching its own resource.
  entity_key text not null check (entity_key <> ''),
  entity_name_snapshot text,
  status text,
  currency text not null,
  account_timezone text not null,
  spend numeric(18, 6) not null default 0 check (spend >= 0),
  impressions bigint not null default 0 check (impressions >= 0),
  clicks bigint not null default 0 check (clicks >= 0),
  registrations numeric(18, 6) check (registrations >= 0),
  purchases numeric(18, 6) check (purchases >= 0),
  order_conversion_value numeric(18, 6) check (order_conversion_value >= 0),
  registration_lead_value numeric(18, 6) check (registration_lead_value >= 0),
  -- True when the conversion columns were filtered to the approved conversion
  -- actions. False means Google's own total, which mixes actions and is not
  -- comparable with a filtered count.
  conversion_action_filtered boolean not null default false,
  source_connector text not null,
  source_query_version text not null,
  synced_at timestamptz not null,
  is_provisional boolean not null default false,
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Performance Max has no ad groups and Search has no asset groups, so a row
  -- claiming both is a pull that went wrong.
  constraint ad_entity_daily_account_client_fkey
    foreign key (account_id, client_id)
    references public.ad_accounts (id, client_id)
    on delete restrict,
  constraint ad_entity_daily_grain_key unique (
    metric_date,
    account_id,
    entity_level,
    entity_key,
    source_query_version
  )
);

create index ad_entity_daily_client_date_idx
  on public.ad_entity_daily (client_id, metric_date);

create index ad_entity_daily_campaign_idx
  on public.ad_entity_daily (client_id, campaign_key, metric_date);

alter table public.ad_entity_daily enable row level security;

revoke all on table public.ad_entity_daily from anon, authenticated;
grant select on table public.ad_entity_daily to authenticated;

create policy ad_entity_daily_select_member
  on public.ad_entity_daily for select
  to authenticated
  using (public.can_access_client(client_id));

comment on table public.ad_entity_daily is
  'Google ad group and asset group performance per brand per day, carrying the parent campaign key so the level can be rolled up or drilled into. Written by the service role only. Reconciles to campaign rows in daily_metrics.';
comment on column public.ad_entity_daily.entity_level is
  'ad_group = Search, Display, Shopping. asset_group = Performance Max. They are stored together but are not interchangeable: only ad_group supports per-conversion-action segmentation.';
comment on column public.ad_entity_daily.conversion_action_filtered is
  'True when purchases and registrations were restricted to the approved conversion actions. False is Google''s own total across every action, which is not comparable with a filtered count.';
