-- Auth, client membership, and RLS gate.
-- Apply only after a private Supabase project is approved and backed up.
-- This migration creates no login account and stores no credential.

create type public.app_role as enum ('admin', 'internal_editor', 'viewer');

create table public.app_users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.client_memberships (
  user_id uuid not null references public.app_users(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete restrict,
  role public.app_role not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, client_id)
);

create index client_memberships_client_role_idx
  on public.client_memberships (client_id, role)
  where is_active;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.app_users (id, email)
  values (new.id, new.email)
  on conflict (id) do update
    set email = excluded.email,
        updated_at = now();
  return new;
end;
$$;

revoke all on function public.handle_new_auth_user() from public;

create trigger on_auth_user_created
  after insert or update of email on auth.users
  for each row execute procedure public.handle_new_auth_user();

-- Existing audit columns become real references once Auth exists.
alter table public.sync_jobs
  alter column requested_by set default auth.uid(),
  add constraint sync_jobs_requested_by_fkey
    foreign key (requested_by) references auth.users(id) on delete set null;

alter table public.worklog_documents
  alter column uploaded_by set default auth.uid(),
  add constraint worklog_documents_uploaded_by_fkey
    foreign key (uploaded_by) references auth.users(id) on delete set null;

alter table public.worklog_entries
  add constraint worklog_entries_reviewed_by_fkey
    foreign key (reviewed_by) references auth.users(id) on delete set null;

alter table public.generated_summaries
  add constraint generated_summaries_generated_by_fkey
    foreign key (generated_by) references auth.users(id) on delete set null,
  add constraint generated_summaries_approved_by_fkey
    foreign key (approved_by) references auth.users(id) on delete set null;

create or replace function public.can_access_client(target_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.client_memberships membership
    where membership.user_id = auth.uid()
      and membership.client_id = target_client_id
      and membership.is_active
  );
$$;

create or replace function public.has_client_role(
  target_client_id uuid,
  accepted_roles public.app_role[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.client_memberships membership
    where membership.user_id = auth.uid()
      and membership.client_id = target_client_id
      and membership.is_active
      and membership.role = any(accepted_roles)
  );
$$;

create or replace function public.can_manage_user(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.client_memberships target_membership
    join public.client_memberships admin_membership
      on admin_membership.client_id = target_membership.client_id
    where target_membership.user_id = target_user_id
      and target_membership.is_active
      and admin_membership.user_id = auth.uid()
      and admin_membership.role = 'admin'
      and admin_membership.is_active
  );
$$;

revoke all on function public.can_access_client(uuid) from public, anon;
revoke all on function public.has_client_role(uuid, public.app_role[]) from public, anon;
revoke all on function public.can_manage_user(uuid) from public, anon;
grant execute on function public.can_access_client(uuid) to authenticated;
grant execute on function public.has_client_role(uuid, public.app_role[]) to authenticated;
grant execute on function public.can_manage_user(uuid) to authenticated;

alter table public.app_users enable row level security;
alter table public.client_memberships enable row level security;

create policy app_users_select_self_or_client_admin
  on public.app_users for select
  to authenticated
  using (
    id = auth.uid()
    or public.can_manage_user(id)
  );

create policy client_memberships_select_self_or_admin
  on public.client_memberships for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.has_client_role(
      client_id,
      array['admin']::public.app_role[]
    )
  );

create policy client_memberships_insert_admin
  on public.client_memberships for insert
  to authenticated
  with check (
    public.has_client_role(
      client_id,
      array['admin']::public.app_role[]
    )
  );

create policy client_memberships_update_admin
  on public.client_memberships for update
  to authenticated
  using (
    user_id <> auth.uid()
    and public.has_client_role(
      client_id,
      array['admin']::public.app_role[]
    )
  )
  with check (
    user_id <> auth.uid()
    and public.has_client_role(
      client_id,
      array['admin']::public.app_role[]
    )
  );

create policy client_memberships_delete_admin
  on public.client_memberships for delete
  to authenticated
  using (
    user_id <> auth.uid()
    and public.has_client_role(
      client_id,
      array['admin']::public.app_role[]
    )
  );

create policy clients_select_member
  on public.clients for select
  to authenticated
  using (public.can_access_client(id));

create policy ad_accounts_select_member
  on public.ad_accounts for select
  to authenticated
  using (public.can_access_client(client_id));

create policy connector_configs_select_editor
  on public.connector_configs for select
  to authenticated
  using (
    exists (
      select 1
      from public.ad_accounts account
      where account.id = connector_configs.account_id
        and public.has_client_role(
          account.client_id,
          array['admin', 'internal_editor']::public.app_role[]
        )
    )
  );

create policy daily_metrics_select_member
  on public.daily_metrics for select
  to authenticated
  using (public.can_access_client(client_id));

create policy sync_jobs_select_member
  on public.sync_jobs for select
  to authenticated
  using (public.can_access_client(client_id));

create policy sync_jobs_insert_editor
  on public.sync_jobs for insert
  to authenticated
  with check (
    requested_by = auth.uid()
    and public.has_client_role(
      client_id,
      array['admin', 'internal_editor']::public.app_role[]
    )
  );

create policy sync_job_events_select_member
  on public.sync_job_events for select
  to authenticated
  using (
    exists (
      select 1
      from public.sync_jobs job
      where job.id = sync_job_events.sync_job_id
        and public.can_access_client(job.client_id)
    )
  );

create policy worklog_documents_select_editor
  on public.worklog_documents for select
  to authenticated
  using (
    public.has_client_role(
      client_id,
      array['admin', 'internal_editor']::public.app_role[]
    )
  );

create policy worklog_documents_insert_editor
  on public.worklog_documents for insert
  to authenticated
  with check (
    uploaded_by = auth.uid()
    and public.has_client_role(
      client_id,
      array['admin', 'internal_editor']::public.app_role[]
    )
  );

create policy worklog_entries_select_member
  on public.worklog_entries for select
  to authenticated
  using (
    public.can_access_client(client_id)
    and (
      review_status = 'approved'
      or public.has_client_role(
        client_id,
        array['admin', 'internal_editor']::public.app_role[]
      )
    )
  );

create policy worklog_entries_insert_editor
  on public.worklog_entries for insert
  to authenticated
  with check (
    public.has_client_role(
      client_id,
      array['admin', 'internal_editor']::public.app_role[]
    )
  );

create policy worklog_entries_update_editor
  on public.worklog_entries for update
  to authenticated
  using (
    public.has_client_role(
      client_id,
      array['admin', 'internal_editor']::public.app_role[]
    )
  )
  with check (
    public.has_client_role(
      client_id,
      array['admin', 'internal_editor']::public.app_role[]
    )
  );

create policy generated_summaries_select_member
  on public.generated_summaries for select
  to authenticated
  using (
    public.can_access_client(client_id)
    and (
      review_status = 'approved'
      or public.has_client_role(
        client_id,
        array['admin', 'internal_editor']::public.app_role[]
      )
    )
  );

create policy generated_summaries_insert_editor
  on public.generated_summaries for insert
  to authenticated
  with check (
    generated_by = auth.uid()
    and public.has_client_role(
      client_id,
      array['admin', 'internal_editor']::public.app_role[]
    )
  );

create policy generated_summaries_update_editor
  on public.generated_summaries for update
  to authenticated
  using (
    public.has_client_role(
      client_id,
      array['admin', 'internal_editor']::public.app_role[]
    )
  )
  with check (
    public.has_client_role(
      client_id,
      array['admin', 'internal_editor']::public.app_role[]
    )
  );

create policy data_quality_issues_select_member
  on public.data_quality_issues for select
  to authenticated
  using (public.can_access_client(client_id));

-- Anonymous access is explicitly removed. Table grants and RLS both apply.
revoke all on table public.app_users from anon;
revoke all on table public.client_memberships from anon;
revoke all on table public.clients from anon;
revoke all on table public.ad_accounts from anon;
revoke all on table public.connector_configs from anon;
revoke all on table public.daily_metrics from anon;
revoke all on table public.sync_jobs from anon;
revoke all on table public.sync_job_events from anon;
revoke all on table public.worklog_documents from anon;
revoke all on table public.worklog_entries from anon;
revoke all on table public.generated_summaries from anon;
revoke all on table public.data_quality_issues from anon;

-- Remove Supabase public-schema defaults before granting the minimum actions.
revoke all on table public.app_users from authenticated;
revoke all on table public.client_memberships from authenticated;
revoke all on table public.clients from authenticated;
revoke all on table public.ad_accounts from authenticated;
revoke all on table public.connector_configs from authenticated;
revoke all on table public.daily_metrics from authenticated;
revoke all on table public.sync_jobs from authenticated;
revoke all on table public.sync_job_events from authenticated;
revoke all on table public.worklog_documents from authenticated;
revoke all on table public.worklog_entries from authenticated;
revoke all on table public.generated_summaries from authenticated;
revoke all on table public.data_quality_issues from authenticated;

grant select on table public.app_users to authenticated;
grant select, insert, update, delete on table public.client_memberships
  to authenticated;
grant select on table public.clients to authenticated;
grant select on table public.ad_accounts to authenticated;
grant select on table public.connector_configs to authenticated;
grant select on table public.daily_metrics to authenticated;
grant select, insert on table public.sync_jobs to authenticated;
grant select on table public.sync_job_events to authenticated;
grant select, insert on table public.worklog_documents to authenticated;
grant select, insert, update on table public.worklog_entries to authenticated;
grant select, insert, update on table public.generated_summaries to authenticated;
grant select on table public.data_quality_issues to authenticated;

-- The pilot client is an approved project fact. Login identities, platform
-- account mappings, and memberships remain deliberately unseeded.
insert into public.clients (slug, display_name)
values ('kopi-senja', 'Kopi Senja Nusantara')
on conflict (slug) do update
  set display_name = excluded.display_name;
