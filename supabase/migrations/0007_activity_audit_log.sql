-- Activity audit log.
--
-- Answers one question after the fact: who did the thing that moved data or
-- took data out of the system. It is a precondition of the store ingestion gate,
-- because the day real customer rows land, an export with no record of who ran
-- it is not something anyone can investigate.
--
-- Append-only by construction: the table carries no update or delete policy,
-- and the writer is the service role. Rows describe an action, never its
-- payload: counts and identifiers only, never an exported customer, never a
-- credential, never a query body.

create table if not exists public.activity_audit_log (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  -- Null for an unattended run, matching sync_jobs.requested_by. A machine
  -- action is not attributed to a person.
  actor_user_id uuid,
  -- Recorded because a membership row can change later and this log must still
  -- say what the actor was allowed to do at the time.
  actor_email text,
  actor_role text check (
    actor_role is null or actor_role in ('admin', 'internal_editor', 'viewer')
  ),
  action text not null check (
    action in (
      'audience.export',
      'sync.manual',
      'sync.backfill',
      'sync.scheduled',
      'connector.connected',
      'connector.disconnected'
    )
  ),
  -- What the action touched: a connector platform, an export preset, a range.
  -- Free-form but never PII; the check below is a blunt guard, not a parser.
  subject text,
  outcome text not null default 'succeeded' check (
    outcome in ('succeeded', 'failed', 'denied')
  ),
  -- Rows exported, rows written, days requested. Counts, not contents.
  record_count integer check (record_count is null or record_count >= 0),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists activity_audit_client_created_idx
  on public.activity_audit_log (client_id, created_at desc);

create index if not exists activity_audit_action_idx
  on public.activity_audit_log (client_id, action, created_at desc);

alter table public.activity_audit_log enable row level security;

-- Members of the client may read their own client's trail. There is no insert,
-- update, or delete policy at all, so no browser session can write a row, edit
-- one, or erase one - including the account that performed the action.
create policy activity_audit_member_select on public.activity_audit_log
  for select to authenticated
  using (
    exists (
      select 1 from public.client_memberships cm
      where cm.client_id = activity_audit_log.client_id
        and cm.user_id = auth.uid()
        and cm.is_active = true
    )
  );

comment on table public.activity_audit_log is
  'Append-only record of data-moving actions: audience exports, manual and scheduled syncs, backfills, and connector connect/disconnect. Service role writes; client members read. Stores counts and identifiers only, never exported data, credentials, or query bodies.';
