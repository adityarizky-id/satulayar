-- Campaign attributes and Google search query facts, per brand.
--
-- `daily_metrics` already holds campaign-level spend and conversions
-- (`entity_level = 'campaign'`). What it cannot hold is what a campaign *is*:
-- its channel type decides which campaign-type row it belongs to, and without
-- it the dashboard fell back to splitting account spend with fixed shares.
-- Search queries are a different grain again (day x ad group x query x matched
-- keyword) and get their own table rather than widening `daily_metrics`.
--
-- Tenant isolation is enforced twice. RLS limits reads to members of the
-- brand, and a composite foreign key makes it impossible to store a row whose
-- `client_id` differs from the brand that owns its ad account. The second
-- guard is what stops an ingestion bug from filing one brand's rows under
-- another brand, which RLS alone cannot detect.

-- Target for the composite foreign keys below. `id` is already unique, so this
-- adds no new rule; it only lets (id, client_id) be referenced as a pair.
alter table public.ad_accounts
  add constraint ad_accounts_id_client_id_key unique (id, client_id);

create table public.ad_campaigns (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  account_id uuid not null,
  platform public.ad_platform not null,
  -- Platform campaign id. Already present as `daily_metrics.entity_key`.
  campaign_key text not null,
  campaign_name text not null,
  -- Google `campaign.advertising_channel_type`, e.g. SEARCH, SHOPPING,
  -- PERFORMANCE_MAX. Stored verbatim; mapping to dashboard types is app logic.
  channel_type text not null,
  channel_sub_type text,
  status text not null,
  source_query_version text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null,
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ad_campaigns_account_client_fkey
    foreign key (account_id, client_id)
    references public.ad_accounts (id, client_id)
    on delete restrict,
  constraint ad_campaigns_account_campaign_key
    unique (account_id, platform, campaign_key)
);

create index ad_campaigns_client_platform_channel_idx
  on public.ad_campaigns (client_id, platform, channel_type);

create table public.ad_search_term_daily (
  id uuid primary key default gen_random_uuid(),
  metric_date date not null,
  client_id uuid not null references public.clients(id) on delete restrict,
  account_id uuid not null,
  platform public.ad_platform not null default 'google'
    check (platform = 'google'),
  campaign_key text not null,
  ad_group_key text not null,
  -- What the user typed. Occasionally contains a personal name or an email
  -- address, so it stays behind RLS and is never sent to an external model.
  search_term text not null check (char_length(search_term) between 1 and 1000),
  search_term_match_type text not null,
  -- Empty string, not null, when no keyword matched (Shopping), so the grain
  -- key below stays a plain unique constraint.
  keyword_text text not null default '',
  keyword_match_type text not null default '',
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  account_timezone text not null,
  spend numeric(18, 6) not null default 0 check (spend >= 0),
  impressions bigint not null default 0 check (impressions >= 0),
  clicks bigint not null default 0 check (clicks >= 0),
  -- Null means "not measured" (no mapped conversion action, or the conversion
  -- pull failed). It must never be read as zero.
  registrations numeric(18, 6) check (registrations >= 0),
  purchases numeric(18, 6) check (purchases >= 0),
  purchase_value numeric(18, 6) check (purchase_value >= 0),
  source_connector text not null,
  source_query_version text not null,
  synced_at timestamptz not null,
  is_provisional boolean not null default false,
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ad_search_term_daily_account_client_fkey
    foreign key (account_id, client_id)
    references public.ad_accounts (id, client_id)
    on delete restrict,
  -- The idempotency contract: re-pulling a trailing window corrects a day
  -- instead of duplicating it.
  constraint ad_search_term_daily_grain_key unique (
    metric_date,
    account_id,
    campaign_key,
    ad_group_key,
    search_term,
    search_term_match_type,
    keyword_text,
    keyword_match_type,
    source_query_version
  )
);

create index ad_search_term_daily_client_date_idx
  on public.ad_search_term_daily (client_id, metric_date);

create index ad_search_term_daily_client_campaign_date_idx
  on public.ad_search_term_daily (client_id, campaign_key, metric_date);

-- Campaign-level reads filter on entity_level, which the existing
-- (client_id, platform, metric_date) index does not cover.
create index if not exists daily_metrics_client_platform_level_date_idx
  on public.daily_metrics (client_id, platform, entity_level, metric_date);

alter table public.ad_campaigns enable row level security;
alter table public.ad_search_term_daily enable row level security;

-- Supabase grants public-schema tables to anon and authenticated by default.
-- Remove that before granting the single action a member needs.
revoke all on table public.ad_campaigns from anon, authenticated;
revoke all on table public.ad_search_term_daily from anon, authenticated;

grant select on table public.ad_campaigns to authenticated;
grant select on table public.ad_search_term_daily to authenticated;

-- Members read their own brand's rows. Nobody writes through a browser
-- session; ingestion runs with the service role, like `daily_metrics`.
create policy ad_campaigns_select_member
  on public.ad_campaigns for select
  to authenticated
  using (public.can_access_client(client_id));

create policy ad_search_term_daily_select_member
  on public.ad_search_term_daily for select
  to authenticated
  using (public.can_access_client(client_id));

comment on table public.ad_campaigns is
  'Campaign attributes per brand ad account (channel type, status). Written by the service role only.';

comment on table public.ad_search_term_daily is
  'Google search query facts per brand: one row per day, ad group, query, and matched keyword. Excludes Dynamic Search Ads queries and queries below Google''s privacy threshold, so it does not reconcile to campaign spend. Suggested retention: 16 months, enough for a year-over-year role check.';
