-- Value split, search impression share, and the Google device breakdown.
--
-- 1. Value split (P1-5). `platform_conversion_value` has only ever held the
--    value of the mapped purchase action (a "New Order" action). The
--    registration action carries a value too (a "New Registration" action)
--    and was discarded at ingestion.
--    Folding it into the existing column would turn e-commerce ROAS into a
--    blend of orders and assigned lead value, so each gets its own column.
--    `platform_conversion_value` is left untouched and keeps meaning "order
--    value" so no existing reader changes behaviour.
--
-- 2. Search impression share (P2-7, Section 9). Three ratios on the rows that
--    already exist, not a new grain. Null means Google did not report a share
--    for that row (a Display campaign, a day without impressions) and must
--    never be read as 0%. Google masks the tails: 0.0999 means "below 10%" and
--    0.9001 "above 90%"; the values are stored as returned and the masking is
--    handled by the reader.
--
-- 3. Device (P2-7, Section 10). A different grain (day x campaign x device), so
--    it gets its own table with the same tenant guards as migration 0009.

alter table public.daily_metrics
  add column order_conversion_value numeric(18, 6)
    check (order_conversion_value >= 0),
  add column registration_lead_value numeric(18, 6)
    check (registration_lead_value >= 0),
  add column search_impression_share numeric(9, 6)
    check (search_impression_share between 0 and 1),
  add column search_budget_lost_impression_share numeric(9, 6)
    check (search_budget_lost_impression_share between 0 and 1),
  add column search_rank_lost_impression_share numeric(9, 6)
    check (search_rank_lost_impression_share between 0 and 1);

comment on column public.daily_metrics.order_conversion_value is
  'Value of the mapped purchase conversion action only. Null when no purchase action is mapped. The e-commerce ROAS numerator.';
comment on column public.daily_metrics.registration_lead_value is
  'Value of the mapped registration conversion action only (assigned B2B lead value). Null when no registration action is mapped. Never part of ROAS.';
comment on column public.daily_metrics.search_impression_share is
  'Google metrics.search_impression_share, 0-1. Null when not reported. 0.0999 is Google''s mask for below 10%.';
comment on column public.daily_metrics.search_budget_lost_impression_share is
  'Google metrics.search_budget_lost_impression_share, 0-1. Null when not reported.';
comment on column public.daily_metrics.search_rank_lost_impression_share is
  'Google metrics.search_rank_lost_impression_share, 0-1. Null when not reported.';

create table public.ad_device_daily (
  id uuid primary key default gen_random_uuid(),
  metric_date date not null,
  client_id uuid not null references public.clients(id) on delete restrict,
  account_id uuid not null,
  platform public.ad_platform not null default 'google'
    check (platform = 'google'),
  campaign_key text not null,
  -- Google `segments.device`, verbatim: MOBILE, DESKTOP, TABLET, CONNECTED_TV,
  -- OTHER. Mapping to dashboard labels is app logic.
  device text not null check (char_length(device) between 1 and 40),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  account_timezone text not null,
  spend numeric(18, 6) not null default 0 check (spend >= 0),
  impressions bigint not null default 0 check (impressions >= 0),
  clicks bigint not null default 0 check (clicks >= 0),
  -- Null means "not measured", as in ad_search_term_daily.
  registrations numeric(18, 6) check (registrations >= 0),
  purchases numeric(18, 6) check (purchases >= 0),
  order_conversion_value numeric(18, 6) check (order_conversion_value >= 0),
  registration_lead_value numeric(18, 6) check (registration_lead_value >= 0),
  source_connector text not null,
  source_query_version text not null,
  synced_at timestamptz not null,
  is_provisional boolean not null default false,
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ad_device_daily_account_client_fkey
    foreign key (account_id, client_id)
    references public.ad_accounts (id, client_id)
    on delete restrict,
  constraint ad_device_daily_grain_key unique (
    metric_date,
    account_id,
    campaign_key,
    device,
    source_query_version
  )
);

create index ad_device_daily_client_date_idx
  on public.ad_device_daily (client_id, metric_date);

alter table public.ad_device_daily enable row level security;

revoke all on table public.ad_device_daily from anon, authenticated;
grant select on table public.ad_device_daily to authenticated;

create policy ad_device_daily_select_member
  on public.ad_device_daily for select
  to authenticated
  using (public.can_access_client(client_id));

comment on table public.ad_device_daily is
  'Google spend, traffic, and mapped conversions per brand per day per campaign per device. Written by the service role only. Reconciles to campaign rows in daily_metrics.';
