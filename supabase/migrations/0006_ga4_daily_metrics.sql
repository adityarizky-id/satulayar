-- Google Analytics 4 daily traffic and behaviour facts.
--
-- Kept out of `daily_metrics`, which holds advertising platform facts keyed by
-- ad account and campaign. GA4 describes the website: a different source, a
-- different grain, and a different population. Mixing them would make
-- "sessions" look like a campaign metric and invite totals that double count.
--
-- Long format on purpose. One row is one day at one breakdown, so a channel
-- cut, a device cut, and the undifferentiated daily total live side by side
-- without a wide cross product that explodes as dimensions are added.

create table if not exists public.ga4_daily_metrics (
  id uuid primary key default gen_random_uuid(),
  metric_date date not null,
  client_id uuid not null references public.clients(id) on delete restrict,
  -- The GA4 property this row was read from. Server-side only: no client query
  -- selects it, for the same reason ad account ids stay off the client.
  property_id text not null,
  breakdown text not null check (
    breakdown in ('total', 'channel', 'device', 'landing_page', 'country', 'city')
  ),
  -- 'total' for the undifferentiated daily row; otherwise the mapped dimension
  -- value, already folded onto the vocabulary the dashboard speaks.
  breakdown_value text not null default 'total',
  currency text not null check (currency ~ '^[A-Z]{3}$'),

  sessions integer not null default 0 check (sessions >= 0),
  active_users integer not null default 0 check (active_users >= 0),
  -- Rates and averages describe this row's grain only. They are never summed
  -- across rows; a re-aggregation must re-weight them by sessions.
  bounce_rate numeric(6, 5) not null default 0
    check (bounce_rate >= 0 and bounce_rate <= 1),
  average_session_duration_seconds numeric(12, 4) not null default 0
    check (average_session_duration_seconds >= 0),

  add_to_carts integer not null default 0 check (add_to_carts >= 0),
  checkouts integer not null default 0 check (checkouts >= 0),
  ecommerce_purchases integer not null default 0 check (ecommerce_purchases >= 0),
  gross_purchase_revenue numeric(18, 6) not null default 0
    check (gross_purchase_revenue >= 0),

  source_connector text not null default 'ga4-direct-api',
  source_query_version text not null default 'ga4-data-api-v1beta',
  synced_at timestamptz not null default now(),
  -- True while the day was still open in the property's own timezone.
  is_provisional boolean not null default false,
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- The idempotency contract. Re-pulling a day corrects it instead of
  -- appending, which is what lets the scheduled job re-read a trailing window
  -- as GA4 restates recent days.
  unique (
    metric_date,
    client_id,
    property_id,
    breakdown,
    breakdown_value,
    source_query_version
  )
);

create index if not exists ga4_daily_client_date_idx
  on public.ga4_daily_metrics (client_id, metric_date);

create index if not exists ga4_daily_breakdown_idx
  on public.ga4_daily_metrics (client_id, breakdown, metric_date);

alter table public.ga4_daily_metrics enable row level security;

-- Client members read their own client's rows; nobody writes through a browser
-- session. Ingestion runs with the service role, exactly like the ads pipeline.
create policy ga4_daily_member_select on public.ga4_daily_metrics
  for select to authenticated
  using (
    exists (
      select 1 from public.client_memberships cm
      where cm.client_id = ga4_daily_metrics.client_id
        and cm.user_id = auth.uid()
        and cm.is_active = true
    )
  );

comment on table public.ga4_daily_metrics is
  'GA4 daily website facts in long format: one row per day per breakdown. Written by the service role only; bounce_rate and average_session_duration_seconds are valid at their own grain and must be re-weighted by sessions if aggregated.';
