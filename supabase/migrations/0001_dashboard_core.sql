-- Satulayar core schema.
-- Security posture: no public policies are created by this migration.
-- Tables remain inaccessible through Supabase Data APIs until reviewed RLS
-- policies and authenticated roles are added in a later gate.

create extension if not exists pgcrypto;

create type public.ad_platform as enum ('meta', 'google', 'ga4', 'other');
create type public.sync_job_status as enum (
  'queued',
  'running',
  'validating',
  'succeeded',
  'partial',
  'failed'
);
create type public.review_status as enum ('draft', 'approved', 'rejected');

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  display_name text not null,
  created_at timestamptz not null default now()
);

create table public.ad_accounts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  platform public.ad_platform not null,
  account_key text not null,
  display_name text not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  account_timezone text not null,
  attribution_setting_snapshot jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, platform, account_key)
);

comment on column public.ad_accounts.account_key is
  'Internal opaque mapping key. Never expose raw platform account identifiers to the client.';

create table public.connector_configs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.ad_accounts(id) on delete cascade,
  connector_type text not null,
  mode text not null check (mode in ('mock', 'live')),
  health_status text not null default 'unverified',
  last_checked_at timestamptz,
  safe_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, connector_type)
);

comment on table public.connector_configs is
  'Operational metadata only. Credentials and tokens belong in the deployment secret manager.';

create table public.daily_metrics (
  id uuid primary key default gen_random_uuid(),
  metric_date date not null,
  client_id uuid not null references public.clients(id) on delete restrict,
  account_id uuid not null references public.ad_accounts(id) on delete restrict,
  platform public.ad_platform not null,
  entity_level text not null check (entity_level in ('account', 'campaign', 'ad_group', 'ad_set', 'ad')),
  entity_key text not null,
  entity_name_snapshot text not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  account_timezone text not null,
  spend numeric(18, 6) not null default 0 check (spend >= 0),
  impressions bigint not null default 0 check (impressions >= 0),
  clicks bigint not null default 0 check (clicks >= 0),
  landing_page_views bigint check (landing_page_views >= 0),
  registrations numeric(18, 6) check (registrations >= 0),
  purchases numeric(18, 6) check (purchases >= 0),
  platform_conversion_value numeric(18, 6),
  actual_purchase_revenue numeric(18, 6),
  source_connector text not null,
  source_query_version text not null,
  synced_at timestamptz not null,
  is_provisional boolean not null default false,
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (
    metric_date,
    platform,
    account_id,
    entity_level,
    entity_key,
    source_query_version
  )
);

create index daily_metrics_account_date_idx
  on public.daily_metrics (account_id, metric_date);
create index daily_metrics_client_platform_date_idx
  on public.daily_metrics (client_id, platform, metric_date);

create table public.sync_jobs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  requested_by uuid,
  requested_start date not null,
  requested_end date not null,
  requested_platforms public.ad_platform[] not null,
  status public.sync_job_status not null default 'queued',
  attempt_count integer not null default 0 check (attempt_count >= 0),
  rows_received integer not null default 0 check (rows_received >= 0),
  rows_upserted integer not null default 0 check (rows_upserted >= 0),
  safe_error_code text,
  safe_error_message text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  check (requested_start <= requested_end)
);

create table public.sync_job_events (
  id bigint generated always as identity primary key,
  sync_job_id uuid not null references public.sync_jobs(id) on delete cascade,
  event_type text not null,
  safe_message text not null,
  event_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.worklog_documents (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  private_storage_key text not null,
  original_filename text not null,
  mime_type text not null,
  byte_size bigint not null check (byte_size > 0),
  sha256 text not null,
  parsing_status text not null default 'queued',
  uploaded_by uuid,
  created_at timestamptz not null default now(),
  unique (client_id, sha256)
);

create table public.worklog_entries (
  id uuid primary key default gen_random_uuid(),
  source_document_id uuid references public.worklog_documents(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete restrict,
  account_id uuid references public.ad_accounts(id) on delete restrict,
  occurred_at timestamptz not null,
  period_start date,
  period_end date,
  platform public.ad_platform,
  scope_level text not null default 'account',
  scope_entity_key text,
  action_type text not null,
  action_summary text not null,
  reason_or_hypothesis text,
  expected_impact text,
  approval_reference text,
  review_status public.review_status not null default 'draft',
  evidence_reference text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    period_start is null
    or period_end is null
    or period_start <= period_end
  )
);

create index worklog_entries_client_occurred_idx
  on public.worklog_entries (client_id, occurred_at);

create table public.generated_summaries (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  account_id uuid references public.ad_accounts(id) on delete restrict,
  period_start date not null,
  period_end date not null,
  input_hash text not null,
  generator_version text not null,
  structured_output jsonb not null,
  review_status public.review_status not null default 'draft',
  generated_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (client_id, account_id, period_start, period_end, input_hash)
);

create table public.data_quality_issues (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  account_id uuid references public.ad_accounts(id) on delete restrict,
  sync_job_id uuid references public.sync_jobs(id) on delete set null,
  issue_code text not null,
  severity text not null check (severity in ('info', 'warning', 'blocking')),
  safe_message text not null,
  affected_start date,
  affected_end date,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.clients enable row level security;
alter table public.ad_accounts enable row level security;
alter table public.connector_configs enable row level security;
alter table public.daily_metrics enable row level security;
alter table public.sync_jobs enable row level security;
alter table public.sync_job_events enable row level security;
alter table public.worklog_documents enable row level security;
alter table public.worklog_entries enable row level security;
alter table public.generated_summaries enable row level security;
alter table public.data_quality_issues enable row level security;

-- Intentionally no seed data and no RLS policies in this gate.
-- Account mappings and access rules require explicit business approval.
