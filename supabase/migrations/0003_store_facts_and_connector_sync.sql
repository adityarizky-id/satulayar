-- Store facts, order provenance, and connector sync tables.
-- Security posture: all tables have RLS enabled with explicit client membership checks.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'store_platform') then
    create type public.store_platform as enum ('shopify', 'woocommerce', 'other');
  end if;
end $$;

create table if not exists public.store_accounts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  platform public.store_platform not null default 'other',
  store_key text not null,
  display_name text not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  timezone text not null default 'UTC',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, platform, store_key)
);

comment on table public.store_accounts is
  'Store identity mappings for e-commerce backends (Shopify, WooCommerce).';

create table if not exists public.fact_store_performance_daily (
  id uuid primary key default gen_random_uuid(),
  metric_date date not null,
  client_id uuid not null references public.clients(id) on delete restrict,
  store_account_id uuid not null references public.store_accounts(id) on delete restrict,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  gross_sales numeric(18, 6) not null default 0 check (gross_sales >= 0),
  net_sales numeric(18, 6) not null default 0,
  dispatched_orders_count integer not null default 0 check (dispatched_orders_count >= 0),
  cancelled_orders_count integer not null default 0 check (cancelled_orders_count >= 0),
  abandoned_baskets_count integer not null default 0 check (abandoned_baskets_count >= 0),
  average_order_value numeric(18, 6) not null default 0 check (average_order_value >= 0),
  source_connector text not null default 'store-connector',
  source_query_version text not null default 'v1.0',
  synced_at timestamptz not null default now(),
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (metric_date, client_id, store_account_id, source_query_version)
);

create index if not exists fact_store_client_date_idx
  on public.fact_store_performance_daily (client_id, metric_date);

create table if not exists public.sync_issues (
  id uuid primary key default gen_random_uuid(),
  sync_job_id uuid references public.sync_jobs(id) on delete set null,
  client_id uuid not null references public.clients(id) on delete restrict,
  platform text not null,
  issue_type text not null,
  severity text not null check (severity in ('info', 'warning', 'blocking')),
  safe_message text not null,
  raw_error_code text,
  occurred_at timestamptz not null default now()
);

create index if not exists sync_issues_client_idx
  on public.sync_issues (client_id, occurred_at);

-- RLS Enforcement
alter table public.store_accounts enable row level security;
alter table public.fact_store_performance_daily enable row level security;
alter table public.sync_issues enable row level security;

-- Client member read access (workspace members)
create policy store_accounts_member_select on public.store_accounts
  for select to authenticated
  using (
    exists (
      select 1 from public.client_memberships cm
      where cm.client_id = store_accounts.client_id
        and cm.user_id = auth.uid()
        and cm.is_active = true
    )
  );

create policy fact_store_member_select on public.fact_store_performance_daily
  for select to authenticated
  using (
    exists (
      select 1 from public.client_memberships cm
      where cm.client_id = fact_store_performance_daily.client_id
        and cm.user_id = auth.uid()
        and cm.is_active = true
    )
  );

create policy sync_issues_member_select on public.sync_issues
  for select to authenticated
  using (
    exists (
      select 1 from public.client_memberships cm
      where cm.client_id = sync_issues.client_id
        and cm.user_id = auth.uid()
        and cm.is_active = true
    )
  );
