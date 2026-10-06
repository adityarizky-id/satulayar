-- Server-side OAuth connector token storage.
-- Security posture: application users have no table privileges, and
-- restrictive RLS policies keep anon/authenticated access fail-closed.

create extension if not exists pgcrypto;

create table if not exists public.connector_tokens (
  id uuid primary key default gen_random_uuid(),
  platform text not null,
  client_slug text not null,
  mcc_id text,
  customer_id text,
  access_token text not null,
  refresh_token text not null,
  token_type text not null default 'Bearer',
  scope text,
  expires_at timestamptz,
  status text not null default 'active',
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint connector_tokens_status_check
    check (status in ('active', 'revoked', 'expired'))
);

create unique index if not exists connector_tokens_platform_client_slug_key
  on public.connector_tokens (platform, client_slug);

create index if not exists connector_tokens_platform_status_idx
  on public.connector_tokens (platform, status);

alter table public.connector_tokens enable row level security;

revoke all on table public.connector_tokens from anon, authenticated;

drop policy if exists connector_tokens_deny_anon
  on public.connector_tokens;
create policy connector_tokens_deny_anon
  on public.connector_tokens
  as restrictive
  for all
  to anon
  using (false)
  with check (false);

drop policy if exists connector_tokens_deny_auth
  on public.connector_tokens;
create policy connector_tokens_deny_auth
  on public.connector_tokens
  as restrictive
  for all
  to authenticated
  using (false)
  with check (false);

grant all on table public.connector_tokens to service_role;

comment on table public.connector_tokens is
  'Server-side OAuth tokens. Access is restricted to the service role.';
