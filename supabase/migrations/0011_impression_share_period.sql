-- Period-grain Google search impression share.
--
-- Migration 0010 added three share columns to `daily_metrics`, one value per
-- day. That grain cannot answer the question the auction panel asks: Google
-- masks any share below 10% as 0.0999, and on a small account most days come
-- back masked. Rolling masked days up produces a period figure that can land
-- close to Google's own number for one ratio and far from it for another. A
-- figure that is close enough to look correct is precisely why a derived
-- number must not be published as a period figure.
--
-- So the period is asked of Google directly and stored at its own grain. The
-- daily columns stay exactly as they are; nothing here replaces them.
--
-- `scope` separates two different questions. 'account' is Google's roll-up over
-- search-eligible traffic for the whole account; 'campaign' is one campaign's
-- own share. The account figure is not the mean of the campaign figures and is
-- never reconstructed from them.
--
-- Null means Google did not report a share for that row. It must never be read
-- as 0%. Google's masked tails (0.0999 for "below 10%", 0.9001 for "above 90%")
-- are stored exactly as returned; deciding what a mask may be shown as is the
-- reader's job, not the database's.

create table public.ad_impression_share_period (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  account_id uuid not null,
  platform public.ad_platform not null default 'google'
    check (platform = 'google'),
  -- The reporting period this row answers for, inclusive. Two different
  -- periods are two different questions and both are kept.
  range_start date not null,
  range_end date not null,
  scope text not null check (scope in ('account', 'campaign')),
  -- Empty string at account scope so the grain key stays non-null. A campaign
  -- row carries the Google campaign id, matching `ad_campaigns.campaign_key`.
  campaign_key text not null default '',
  impressions bigint not null default 0 check (impressions >= 0),
  search_impression_share numeric(9, 6)
    check (search_impression_share between 0 and 1),
  search_budget_lost_impression_share numeric(9, 6)
    check (search_budget_lost_impression_share between 0 and 1),
  search_rank_lost_impression_share numeric(9, 6)
    check (search_rank_lost_impression_share between 0 and 1),
  source_connector text not null,
  source_query_version text not null,
  synced_at timestamptz not null,
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ad_impression_share_period_range_order check (range_start <= range_end),
  constraint ad_impression_share_period_account_scope_key check (
    scope <> 'account' or campaign_key = ''
  ),
  constraint ad_impression_share_period_campaign_scope_key check (
    scope <> 'campaign' or campaign_key <> ''
  ),
  constraint ad_impression_share_period_account_client_fkey
    foreign key (account_id, client_id)
    references public.ad_accounts (id, client_id)
    on delete restrict,
  -- Re-running the same window corrects the row instead of adding a second
  -- copy of it, which is what makes a repeated backfill safe.
  constraint ad_impression_share_period_grain_key unique (
    account_id,
    range_start,
    range_end,
    scope,
    campaign_key,
    source_query_version
  )
);

create index ad_impression_share_period_client_range_idx
  on public.ad_impression_share_period (client_id, range_start, range_end);

alter table public.ad_impression_share_period enable row level security;

revoke all on table public.ad_impression_share_period from anon, authenticated;
grant select on table public.ad_impression_share_period to authenticated;

create policy ad_impression_share_period_select_member
  on public.ad_impression_share_period for select
  to authenticated
  using (public.can_access_client(client_id));

comment on table public.ad_impression_share_period is
  'Google search impression share asked at period grain, one row per account or campaign per reporting window. Exists because masked daily shares cannot be averaged back into the period figure Google reports. Written by the service role only.';
comment on column public.ad_impression_share_period.scope is
  'account = Google''s roll-up across search-eligible traffic; campaign = one campaign. The account value is never the mean of the campaign values.';
comment on column public.ad_impression_share_period.search_rank_lost_impression_share is
  'Google metrics.search_rank_lost_impression_share for the whole period, 0-1. Null when not reported, never 0.';
