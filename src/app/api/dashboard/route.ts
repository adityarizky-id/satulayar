import { NextRequest } from "next/server";

import { resolveClientScope } from "@/lib/auth/client-scope";
import {
  resolveAccount,
  resolvePlatformForAccount,
} from "@/lib/dashboard/accounts";
import { authFailureResponse, privateJson } from "@/lib/auth/http";
import { resolveAuthContext } from "@/lib/auth/session";
import {
  buildDashboardSnapshot,
  buildDashboardSnapshotFromRows,
} from "@/lib/dashboard/fixtures";
import { enumerateDates } from "@/lib/dashboard/data-quality";
import {
  budgetsCookieName,
  DEFAULT_BUDGETS,
  parseBudgetsCookie,
  parseBudgetsFromParams,
  type BudgetPlanSource,
} from "@/lib/dashboard/budget";
import {
  GEO_LEVEL_ORDER,
  type GeoLevel,
} from "@/lib/dashboard/geo/contract";
import { parseTargetsFromParams } from "@/lib/dashboard/targets";
import type { DateRange } from "@/lib/dashboard/types";
import {
  normaliseComparisonWindow,
  resolveComparisonRange,
} from "@/lib/dashboard/search-terms";
import {
  getDashboardDataConfiguration,
  parsePlatform,
  validateDateRange,
  type DashboardDataEnvironment,
} from "@/lib/dashboard/validation";
import {
  readStoredCampaignAttributes,
  readStoredCampaignMetrics,
  readPeriodImpressionShare,
  readStoredAudienceDaily,
  readStoredDeviceMetrics,
  readStoredEntityDaily,
  readStoredGeoDaily,
  readStoredSearchTerms,
  readStoredMetrics,
  resolveBudgetsForClient,
} from "@/lib/supabase/server";
import {
  currentDateInTimeZone,
  resolvePacingCycle,
  resolveTimeframe,
} from "@/lib/dashboard/timeframes";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // The account decides whose rows are read. It is validated strictly: an
  // unknown slug is refused rather than falling back to the pilot, and the
  // session is checked against the brand actually requested. Resolving the
  // session against the pilot served Kopi Senja Nusantara rows for every brand.
  const scope = resolveClientScope(request.nextUrl.searchParams.get("account"));
  if (!scope.ok) {
    return privateJson({ error: scope.message }, { status: 400 });
  }

  const auth = await resolveAuthContext(scope.clientSlug);
  if (!auth.ok) return authFailureResponse(auth);

  const account = resolveAccount(scope.clientSlug);
  const referenceDate = currentDateInTimeZone(account.timezone);
  const defaultRange = resolveTimeframe("14d", referenceDate);
  const start =
    request.nextUrl.searchParams.get("start") ?? defaultRange?.start;
  const end = request.nextUrl.searchParams.get("end") ?? defaultRange?.end;
  const platform = resolvePlatformForAccount(
    account,
    parsePlatform(request.nextUrl.searchParams.get("platform")),
  );
  const targets = parseTargetsFromParams(request.nextUrl.searchParams);
  // Query-string budgets are the caller's own draft, not an authority. They
  // are honoured only where nothing has been agreed for this brand, so a
  // request still carrying the previously selected brand's figures cannot
  // overwrite what the team agreed for the brand actually being read.
  const requestBudgets = request.nextUrl.searchParams.has("budgetMeta")
    ? parseBudgetsFromParams(request.nextUrl.searchParams)
    : null;
  const requestedComparison = request.nextUrl.searchParams.get("compare");
  // "off" is the reader switching comparison off entirely. The window still
  // resolves underneath it, because the rule-based panels need a reference
  // period even when no delta is shown.
  const comparisonEnabled = requestedComparison !== "off";
  const comparisonWindow = normaliseComparisonWindow(requestedComparison);
  const requestedLevel = request.nextUrl.searchParams.get("geoLevel");
  const geo = {
    countryCode:
      request.nextUrl.searchParams.get("geoCountry") ?? undefined,
    level: GEO_LEVEL_ORDER.includes(requestedLevel as GeoLevel)
      ? (requestedLevel as GeoLevel)
      : undefined,
    parentId: request.nextUrl.searchParams.get("geoParent"),
  };
  const range = validateDateRange(start, end);

  if (!range.ok) {
    return privateJson(
      { error: range.message },
      { status: 400 },
    );
  }

  // A custom baseline is only honoured when the caller asked for one. It is
  // rejected rather than quietly replaced, so a bad range never reports a
  // different comparison than the one the reader chose.
  let customComparisonRange: DateRange | undefined;

  if (comparisonWindow === "custom") {
    const requested = validateDateRange(
      request.nextUrl.searchParams.get("compareStart"),
      request.nextUrl.searchParams.get("compareEnd"),
    );

    if (!requested.ok) {
      return privateJson(
        { error: `Comparison period: ${requested.message}` },
        { status: 400 },
      );
    }

    customComparisonRange = requested.value;
  }

  const comparisonRange = resolveComparisonRange(
    range.value,
    comparisonWindow ?? "previous",
    customComparisonRange,
  );

  const requestedMode = request.nextUrl.searchParams.get("mode");
  const configuration = getDashboardDataConfiguration(
    process.env as DashboardDataEnvironment,
    requestedMode,
  );

  // Scoped to the brand named in the request, never to the pilot and never to
  // a global cookie. Precedence: the stored agreement, then this browser's
  // per-brand cookie, then the figures the caller sent, then the placeholder.
  const budgetsCookie = request.cookies.get(
    budgetsCookieName(scope.clientSlug),
  )?.value;
  let budgetPlan: {
    budgets: typeof DEFAULT_BUDGETS;
    source: BudgetPlanSource;
    cycleStart: string | null;
  } = {
    budgets:
      budgetsCookie !== undefined
        ? parseBudgetsCookie(budgetsCookie)
        : requestBudgets ?? DEFAULT_BUDGETS,
    source:
      budgetsCookie !== undefined || requestBudgets ? "local" : "unset",
    cycleStart: null,
  };

  try {
    const resolved = await resolveBudgetsForClient({
      clientId: auth.context.access.clientId,
      cycleStart: resolvePacingCycle(range.value, referenceDate).start,
      currency: account.currency,
      cookieValue: budgetsCookie,
      useStore:
        configuration.storage === "supabase" &&
        auth.context.mode === "supabase",
    });

    // An unset store still leaves the caller's draft usable; an agreement
    // always wins over it.
    budgetPlan =
      resolved.source === "unset" && requestBudgets
        ? { budgets: requestBudgets, source: "local", cycleStart: null }
        : resolved;
  } catch {
    // A wrong-currency or unreadable agreement must not fail the whole read.
    // The fallback above stands, and the card labels it as not agreed.
  }

  const budgets = budgetPlan.budgets;
  const budgetPlanMeta = {
    source: budgetPlan.source,
    cycleStart: budgetPlan.cycleStart,
  };
  // Budget pacing measures the 30-day cycle the selected window closes in, so
  // the metric read has to cover that cycle even when the filter is narrower.
  const pacingCycle = resolvePacingCycle(range.value, referenceDate);

  if (configuration.storage === "fixture") {
    return privateJson(
      buildDashboardSnapshot(
        range.value,
        platform,
        account,
        targets,
        budgets,
        geo,
        comparisonWindow,
        customComparisonRange,
        comparisonEnabled,
        budgetPlanMeta,
        referenceDate,
      ),
    );
  }

  if (auth.context.mode !== "supabase") {
    return privateJson(
      {
        error:
          "Supabase storage requires Supabase authentication. Check the dashboard environment.",
      },
      { status: 503 },
    );
  }

  try {
    const rows = await readStoredMetrics(
      auth.context.access.clientId,
      range.value,
      platform,
      configuration.mode,
      comparisonRange,
      { start: pacingCycle.start, end: pacingCycle.end },
    );

    // Campaign rows are a second read at a different grain, never folded into
    // the KPI totals above. They feed the campaign-type table only, which is
    // what lets that panel report real campaigns instead of a fixed split.
    // Search query rows are Google-only and a third grain again; they feed the
    // search-term section only. A Meta-filtered view skips the read entirely.
    const [
      campaignRows,
      comparisonCampaignRows,
      campaignAttributes,
      searchTermRows,
      deviceRows,
      impressionSharePeriodRows,
      entityRows,
      comparisonEntityRows,
      geoRows,
      comparisonGeoRows,
      audienceRows,
    ] = await Promise.all([
      readStoredCampaignMetrics(
        auth.context.access.clientId,
        range.value,
        platform,
        configuration.mode,
      ),
      comparisonEnabled
        ? readStoredCampaignMetrics(
            auth.context.access.clientId,
            comparisonRange,
            platform,
            configuration.mode,
          )
        : Promise.resolve([]),
      readStoredCampaignAttributes(auth.context.access.clientId, platform),
      platform === "meta"
        ? Promise.resolve([])
        : readStoredSearchTerms(
          auth.context.access.clientId,
          range.value,
          configuration.mode,
          comparisonEnabled ? comparisonRange : undefined,
        ),
      // Fourth grain: one row per device per day. Google-only, and the reader
      // returns nothing under a Meta filter rather than inventing a cut Meta
      // does not report.
      readStoredDeviceMetrics(
        auth.context.access.clientId,
        range.value,
        platform,
        configuration.mode,
      ),
      // Fifth grain: impression share asked of Google at period scope. Masked
      // daily shares cannot be averaged back into a period figure, so this is
      // the only read that can answer the auction panel.
      platform === "meta"
        ? Promise.resolve([])
        : readPeriodImpressionShare(
          auth.context.access.clientId,
          range.value,
          configuration.mode,
        ),
      // Sixth, seventh and eighth grains: ad group and asset group, location,
      // and audience segment. Geography now feeds its live panel; entity and
      // audience remain diagnostic payloads until their own sections consume
      // them.
      readStoredEntityDaily(
        auth.context.access.clientId,
        range.value,
        platform,
        configuration.mode,
      ),
      comparisonEnabled
        ? readStoredEntityDaily(
            auth.context.access.clientId,
            comparisonRange,
            platform,
            configuration.mode,
          )
        : Promise.resolve([]),
      platform === "meta"
        ? Promise.resolve([])
        : Promise.all(
            enumerateDates(range.value).map((date) =>
              readStoredGeoDaily(
                auth.context.access.clientId,
                { start: date, end: date },
                configuration.mode,
              ),
            ),
          ).then((dailyRows) => dailyRows.flat()),
      platform === "meta" || !comparisonEnabled
        ? Promise.resolve([])
        : Promise.all(
            enumerateDates(comparisonRange).map((date) =>
              readStoredGeoDaily(
                auth.context.access.clientId,
                { start: date, end: date },
                configuration.mode,
              ),
            ),
          ).then((dailyRows) => dailyRows.flat()),
      platform === "meta"
        ? Promise.resolve([])
        : Promise.all(
            enumerateDates(range.value).map((date) =>
              readStoredAudienceDaily(
                auth.context.access.clientId,
                { start: date, end: date },
                configuration.mode,
              ),
            ),
          ).then((dailyRows) => dailyRows.flat()),
    ]);

    const snapshot = buildDashboardSnapshotFromRows(
        rows,
        range.value,
        platform,
        {
          account: {
            id: auth.context.access.clientSlug,
            name: auth.context.access.clientName,
            // The brand contract currency. The data-quality gate compares every
            // stored row against it, so a label that disagrees with the data
            // blocks instead of rendering.
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
          comparisonEnabled,
          comparisonWindow,
          comparisonRange: customComparisonRange,
          geo: {
            ...geo,
            accountSlug: account.slug,
            scale: account.fixtureScale,
          },
          campaigns: {
            rows: campaignRows,
            comparisonRows: comparisonCampaignRows,
            attributes: campaignAttributes,
            entityRows,
            comparisonEntityRows,
          },
          searchTerms: { rows: searchTermRows },
        },
    );

    // Raw diagnostic rows stay available for troubleshooting. Geography and
    // audience and entity also feed the typed snapshot above; the raw cuts stay
    // available here for operator troubleshooting without exposing account ids.
    return privateJson({
      ...snapshot,
      diagnostics: { entityRows, geoRows, audienceRows },
    });
  } catch {
    return privateJson(
      {
        error:
          "Stored dashboard data is unavailable. Check Supabase configuration and migrations.",
      },
      { status: 503 },
    );
  }
}
