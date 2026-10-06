-- Agreed monthly advertising budget, per brand, per 30-day reporting cycle.
--
-- WHY A TABLE AND NOT A COOKIE
--
-- The budget was a single browser cookie, `sl_budgets`, holding one Meta and
-- one Google figure for every brand at once. Switching the brand selector did
-- not change it, so one brand's plan paced another brand's spend, and each
-- brand's separate agreement was invisible to the app.
-- A cookie also dies with the browser profile: the number the team agreed
-- with the client survived only on one laptop, unreadable by a colleague and
-- unauditable afterwards.
--
-- WHY THE GRAIN IS (client, cycle_start) AND NOT (client)
--
-- The plan is re-agreed every cycle. A single row per brand would rewrite
-- history: raising October's budget would retroactively change what September
-- was paced against, and last month's report would quietly disagree with the
-- PDF already sent. One row per cycle keeps each agreement where it was made.
--
-- WHY cycle_start AND NOT A CALENDAR MONTH
--
-- Reporting does not follow calendar months. The cycles ratified on
-- 2026-09-14 run 27 Mar-25 Apr, 26 Apr-25 May, 26 May-24 Jun, 25 Jun-24 Jul,
-- 25 Jul-23 Aug, 24 Aug-22 Sep: thirty days each, back to back. The check
-- constraint below pins `cycle_start` to that phase, so a row can never land
-- mid-cycle and silently become unreachable to the reader, which resolves a
-- date to its cycle by the same arithmetic.
--
-- The stored `currency` is a guard, not a preference. A figure agreed in
-- pounds read back against a euro account would be printed with the wrong
-- symbol and compared against euro spend. The reader refuses the mismatch
-- rather than converting: this dashboard never converts currency.

create table public.client_budgets (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  -- First day of the 30-day reporting cycle this agreement covers.
  cycle_start date not null,
  meta_monthly_budget numeric(14, 2) not null default 0
    check (meta_monthly_budget >= 0 and meta_monthly_budget <= 10000000),
  google_monthly_budget numeric(14, 2) not null default 0
    check (google_monthly_budget >= 0 and google_monthly_budget <= 10000000),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  -- Who agreed it and when, in free text. No client contact details here.
  note text,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_budgets_cycle_phase
    check (((cycle_start - date '2026-03-27') % 30) = 0),
  constraint client_budgets_client_cycle_key unique (client_id, cycle_start)
);

create index client_budgets_client_cycle_idx
  on public.client_budgets (client_id, cycle_start desc);

alter table public.client_budgets enable row level security;

revoke all on table public.client_budgets from anon, authenticated;
grant select, insert, update on table public.client_budgets to authenticated;

-- Any member of the brand may read the plan: pacing is meaningless without it.
create policy client_budgets_select_member
  on public.client_budgets for select
  to authenticated
  using (public.can_access_client(client_id));

-- Setting a budget is stating what the team agreed with the client, so it is
-- an editor action. A viewer reads the plan and cannot rewrite it.
create policy client_budgets_insert_editor
  on public.client_budgets for insert
  to authenticated
  with check (
    public.has_client_role(
      client_id,
      array['admin', 'internal_editor']::public.app_role[]
    )
  );

create policy client_budgets_update_editor
  on public.client_budgets for update
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

-- No delete policy and no delete grant: an agreement that was acted on is not
-- removed, it is superseded by the next cycle's row.

comment on table public.client_budgets is
  'Agreed monthly advertising budget per brand per 30-day reporting cycle, in the brand''s own currency and never converted. Replaces the global sl_budgets cookie, which carried one brand''s plan into every other brand. One row per cycle so re-agreeing a budget cannot rewrite what a past period was paced against.';
comment on column public.client_budgets.cycle_start is
  'First day of the 30-day reporting cycle, phase-locked to the 2026-03-27 anchor. A cycle is named after the month it closes in: 24 Aug - 22 Sep is the September report.';
comment on column public.client_budgets.currency is
  'The currency the figure was agreed in. Read as a guard: a row whose currency disagrees with the account is refused, never converted.';
