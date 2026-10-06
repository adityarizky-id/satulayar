import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import {
  ACCOUNT_COOKIE,
  ACCOUNT_OPTIONS,
  resolveAccount,
  resolvePlatformForAccount,
} from "@/lib/dashboard/accounts";
import {
  budgetsCookieName,
  DEFAULT_BUDGETS,
  parseBudgetsCookie,
  type BudgetPlanSource,
} from "@/lib/dashboard/budget";
import {
  parseTargetsCookie,
  TARGETS_COOKIE,
} from "@/lib/dashboard/targets";
import { resolveComparisonRange } from "@/lib/dashboard/search-terms";
import { listWorklog, toWorklogEntries } from "@/lib/dashboard/worklog";
import { resolveAuthContext } from "@/lib/auth/session";
import {
  buildDashboardSnapshot,
  buildDashboardSnapshotFromRows,
} from "@/lib/dashboard/fixtures";
import { enumerateDates } from "@/lib/dashboard/data-quality";
import { getDashboardDataConfiguration } from "@/lib/dashboard/validation";
import {
  currentDateInTimeZone,
  resolvePacingCycle,
  resolveTimeframe,
} from "@/lib/dashboard/timeframes";
import {
  readStoredCampaignAttributes,
  readStoredCampaignMetrics,
  readPeriodImpressionShare,
  readStoredAudienceDaily,
  readStoredDeviceMetrics,
  readStoredGeoDaily,
  readStoredSearchTerms,
  readStoredMetrics,
  resolveBudgetsForClient,
} from "@/lib/supabase/server";
import { BrandGlyph } from "@/components/dashboard/brand-mark";

export const dynamic = "force-dynamic";

export default async function Home() {
  // The selected brand is resolved before the session, and the session is
  // checked against THAT brand. Resolving against the pilot is what made every
  // brand read Kopi Senja Nusantara rows while the hero labelled them with the selected
  // brand currency.
  const cookieStore = await cookies();
  const account = resolveAccount(cookieStore.get(ACCOUNT_COOKIE)?.value);
  const auth = await resolveAuthContext(account.slug);

  if (!auth.ok) {
    if (auth.code === "client_access_denied") {
      return (
        <main className="route-state">
          <span className="route-state__mark route-state__mark--error"><BrandGlyph className="route-state__glyph" /></span>
          <h1>Client access is not assigned.</h1>
          <p>{auth.safeMessage}</p>
          <form action="/api/auth/sign-out" method="post">
            <button className="button button--secondary" type="submit">
              Sign out
            </button>
          </form>
        </main>
      );
    }

    redirect("/sign-in");
  }

  const configuration = getDashboardDataConfiguration();
  const now = new Date();
  const referenceDates = Object.fromEntries(
    ACCOUNT_OPTIONS.map((option) => [
      option.slug,
      currentDateInTimeZone(option.timezone, now),
    ]),
  );
  const referenceDate = referenceDates[account.slug] as string;
  const defaultRange = resolveTimeframe("14d", referenceDate);

  if (!defaultRange) {
    throw new Error("The default reporting period could not be resolved.");
  }
  const initialPlatform = resolvePlatformForAccount(account, "all");
  const targets = parseTargetsCookie(cookieStore.get(TARGETS_COOKIE)?.value);
  // The plan is read for THIS brand and only this brand. The cookie is now
  // namespaced per slug, and the stored agreement is scoped by client_id under
  // the caller's own session, so switching the selector can no longer carry
  // one brand's pounds into another brand's euro pacing.
  const budgetsCookie = cookieStore.get(budgetsCookieName(account.slug))?.value;
  let budgetPlan: {
    budgets: typeof DEFAULT_BUDGETS;
    source: BudgetPlanSource;
    cycleStart: string | null;
  } = {
    budgets: budgetsCookie ? parseBudgetsCookie(budgetsCookie) : DEFAULT_BUDGETS,
    source: budgetsCookie ? "local" : "unset",
    cycleStart: null,
  };

  try {
    budgetPlan = await resolveBudgetsForClient({
      clientId: auth.context.access.clientId,
      cycleStart: resolvePacingCycle(defaultRange, referenceDate).start,
      currency: account.currency,
      cookieValue: budgetsCookie,
      useStore:
        configuration.storage === "supabase" &&
        auth.context.mode === "supabase",
    });
  } catch {
    // An unreadable or wrong-currency agreement must not blank the dashboard.
    // The per-brand cookie or the placeholder stands in, and the card says so
    // rather than presenting either as the figure the team agreed.
  }

  const budgets = budgetPlan.budgets;
  // Logged entries replace the demo chronology as soon as one is approved.
  const storedWorklog = toWorklogEntries(listWorklog(account.slug));
  const budgetPlanMeta = {
    source: budgetPlan.source,
    cycleStart: budgetPlan.cycleStart,
  };
  let initialSnapshot = buildDashboardSnapshot(
    defaultRange,
    initialPlatform,
    account,
    targets,
    budgets,
    undefined,
    undefined,
    undefined,
    undefined,
    budgetPlanMeta,
  );

  if (storedWorklog.length > 0) {
    initialSnapshot = { ...initialSnapshot, worklog: storedWorklog };
  }

  if (configuration.storage === "supabase") {
    if (auth.context.mode !== "supabase") {
      return (
        <main className="route-state">
          <span className="route-state__mark route-state__mark--error"><BrandGlyph className="route-state__glyph" /></span>
          <h1>Supabase storage is not ready.</h1>
          <p>
            Set dashboard authentication to Supabase before enabling stored
            dummy data.
          </p>
        </main>
      );
    }

    try {
      // The third window is the reporting cycle the default range closes in.
      // Budget pacing measures that cycle, not the 14-day default filter, so
      // its earlier days have to be in this read or the card under-reports
      // cycle spend against the full agreed budget.
      const pacingCycle = resolvePacingCycle(defaultRange, referenceDate);
      const rows = await readStoredMetrics(
        auth.context.access.clientId,
        defaultRange,
        initialPlatform,
        configuration.mode,
        undefined,
        { start: pacingCycle.start, end: pacingCycle.end },
      );
      // Second read, campaign grain. Kept out of the KPI totals on purpose.
      const [
        campaignRows,
        campaignAttributes,
        searchTermRows,
        deviceRows,
        impressionSharePeriodRows,
        geoRows,
        comparisonGeoRows,
        audienceRows,
      ] = await Promise.all([
        readStoredCampaignMetrics(
          auth.context.access.clientId,
          defaultRange,
          initialPlatform,
          configuration.mode,
        ),
        readStoredCampaignAttributes(
          auth.context.access.clientId,
          initialPlatform,
        ),
        // Third grain: search queries, for the selected period and the default
        // previous-period baseline the snapshot compares against.
        readStoredSearchTerms(
          auth.context.access.clientId,
          defaultRange,
          configuration.mode,
          resolveComparisonRange(defaultRange, "previous"),
        ),
        // Fourth grain: one row per device per day, Google-only.
        readStoredDeviceMetrics(
          auth.context.access.clientId,
          defaultRange,
          initialPlatform,
          configuration.mode,
        ),
        // Fifth grain: impression share asked of Google at period scope, which
        // is the only grain that can answer it. Masked daily shares cannot be
        // averaged back into the period figure Google reports.
        readPeriodImpressionShare(
          auth.context.access.clientId,
          defaultRange,
          configuration.mode,
        ),
        // Geography can exceed Supabase's 1,000-row response cap for a single
        // brand/window. Read one day at a time through the existing RLS reader
        // so every row is retained without changing the locked ingestion DAL.
        initialPlatform === "meta"
          ? Promise.resolve([])
          : Promise.all(
              enumerateDates(defaultRange).map((date) =>
                readStoredGeoDaily(
                  auth.context.access.clientId,
                  { start: date, end: date },
                  configuration.mode,
                ),
              ),
            ).then((dailyRows) => dailyRows.flat()),
        initialPlatform === "meta"
          ? Promise.resolve([])
          : Promise.all(
              enumerateDates(
                resolveComparisonRange(defaultRange, "previous"),
              ).map((date) =>
                readStoredGeoDaily(
                  auth.context.access.clientId,
                  { start: date, end: date },
                  configuration.mode,
                ),
              ),
            ).then((dailyRows) => dailyRows.flat()),
        // Audience rows can also exceed PostgREST's default 1,000-row cap.
        // Partitioning by day retains the full measured criterion grain.
        initialPlatform === "meta"
          ? Promise.resolve([])
          : Promise.all(
              enumerateDates(defaultRange).map((date) =>
                readStoredAudienceDaily(
                  auth.context.access.clientId,
                  { start: date, end: date },
                  configuration.mode,
                ),
              ),
            ).then((dailyRows) => dailyRows.flat()),
      ]);
      initialSnapshot = buildDashboardSnapshotFromRows(
        rows,
        defaultRange,
        initialPlatform,
        {
          account: {
            id: account.slug,
            name: account.name,
            currency: account.currency,
            timezone: account.timezone,
          },
          mode: configuration.mode,
          storage: configuration.storage,
          targets,
          budgets,
          budgetPlan: budgetPlanMeta,
          referenceDate,
          deviceRows,
          impressionSharePeriodRows,
          geoRows,
          comparisonGeoRows,
          audienceRows,
          geo: { accountSlug: account.slug },
          campaigns: { rows: campaignRows, attributes: campaignAttributes },
          searchTerms: { rows: searchTermRows },
        },
      );
    } catch {
      return (
        <main className="route-state">
          <span className="route-state__mark route-state__mark--error"><BrandGlyph className="route-state__glyph" /></span>
          <h1>Stored dashboard data is unavailable.</h1>
          <p>Check Supabase configuration and apply the approved migrations.</p>
        </main>
      );
    }
  }

  // A credential update says when access was authorised, not when metric rows
  // last landed. The timestamp shown to operators must come from the stored
  // data currently backing the dashboard.
  const initialLastDataSyncAt = initialSnapshot.lastSuccessfulSync;

  return (
    <DashboardShell
      accounts={ACCOUNT_OPTIONS}
      initialLastDataSyncAt={initialLastDataSyncAt}
      initialSnapshot={initialSnapshot}
      initialBudgets={budgets}
      referenceDates={referenceDates}
      initialTargets={targets}
      selectedAccount={account.slug}
      viewer={{
        email: auth.context.email,
        mode: auth.context.mode,
        role: auth.context.access.role,
      }}
    />
  );
}
