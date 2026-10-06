import { NextRequest } from "next/server";

import { hasPermission } from "@/lib/auth/authorization";
import { resolveClientScope } from "@/lib/auth/client-scope";
import {
  authFailureResponse,
  isSameOriginRequest,
  privateJson,
} from "@/lib/auth/http";
import { resolveAuthContext } from "@/lib/auth/session";
import {
  resolveAccount,
  resolvePlatformForAccount,
} from "@/lib/dashboard/accounts";
import { buildDashboardSnapshot } from "@/lib/dashboard/fixtures";
import {
  normaliseComparisonWindow,
} from "@/lib/dashboard/search-terms";
import type { DashboardDataMode, DateRange } from "@/lib/dashboard/types";
// Shared with the shell so the badge and the route cannot drift apart. The
// contract lives in the store domain, not here: a route file may only export
// its handlers.
import type { StoreModeStatus } from "@/lib/store/types";
import {
  getDashboardDataConfiguration,
  parseDataMode,
  validateDateRange,
  type DashboardDataEnvironment,
} from "@/lib/dashboard/validation";
import { buildStoreAnalyticsSnapshot, storeForAccount } from "@/lib/store/analytics";
import { applyGa4Hydration } from "@/lib/store/ga4-hydration";
import { readGa4DailyMetrics } from "@/lib/supabase/server";
import type { AuthContext } from "@/lib/auth/types";
import {
  currentDateInTimeZone,
  resolveTimeframe,
} from "@/lib/dashboard/timeframes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface StoreRefreshRequest {
  start?: unknown;
  end?: unknown;
  account?: unknown;
  compare?: unknown;
  compareStart?: unknown;
  compareEnd?: unknown;
  mode?: unknown;
}

/** What the reporting-period picker sent, before it is trusted. */
interface ComparisonRequest {
  compare: unknown;
  compareStart: unknown;
  compareEnd: unknown;
}


async function snapshotResponse(
  auth: AuthContext,
  clientSlug: string,
  start: unknown,
  end: unknown,
  comparison: ComparisonRequest,
  requestedMode: DashboardDataMode | null,
  lastSuccessfulSyncAt?: Date,
) {
  const range = validateDateRange(start, end);

  if (!range.ok) {
    return privateJson({ error: range.message }, { status: 400 });
  }

  // "off" is the reader unticking Compare. The window still resolves
  // underneath it so the snapshot can name the baseline it is withholding.
  const comparisonEnabled = comparison.compare !== "off";
  const comparisonWindow = normaliseComparisonWindow(
    typeof comparison.compare === "string" ? comparison.compare : null,
  );

  // A custom baseline is rejected rather than quietly replaced, so a bad range
  // never reports a different comparison than the one the reader chose.
  let customComparisonRange: DateRange | undefined;

  if (comparisonWindow === "custom") {
    const requested = validateDateRange(
      comparison.compareStart,
      comparison.compareEnd,
    );

    if (!requested.ok) {
      return privateJson(
        { error: `Comparison period: ${requested.message}` },
        { status: 400 },
      );
    }

    customComparisonRange = requested.value;
  }

  // The brand rendered is the brand the session was checked against, never a
  // separately parsed slug. Resolving those two independently is what let a
  // session authorised for the pilot render another brand's store page.
  const account = resolveAccount(clientSlug);
  const paidSnapshot = buildDashboardSnapshot(
    range.value,
    resolvePlatformForAccount(account, "all"),
    account,
  );

  const syntheticSnapshot = buildStoreAnalyticsSnapshot(range.value, {
    store: storeForAccount(account),
    scale: account.fixtureScale,
    lastSuccessfulSyncAt,
    comparisonEnabled,
    comparisonWindow,
    comparisonRange: customComparisonRange,
    estimatedBlendedCac: paidSnapshot.blendedMer?.blendedCpa,
  });

  const configuration = getDashboardDataConfiguration(
    process.env as DashboardDataEnvironment,
    requestedMode,
  );

  const modeStatus: StoreModeStatus = {
    requested: requestedMode,
    resolved: configuration.mode,
    storage: configuration.storage,
    liveTrafficApplied: false,
    reason: null,
  };

  const synthetic = (reason: string) =>
    privateJson({ ...syntheticSnapshot, modeStatus: { ...modeStatus, reason } });

  // Fail-closed. Mock is checked in its own right and first, not inferred from
  // `configuration.storage`. Today storage is derived from mode, so the two
  // agree; if that derivation is ever relaxed, a mock request must still never
  // open a Supabase connection. This is the line that guarantees it.
  if (configuration.mode === "mock") {
    return synthetic(
      "Mock mode was requested, so no Supabase or GA4 read was attempted.",
    );
  }

  // `DASHBOARD_DATA_STORE=supabase` is what says the rows have a durable home.
  if (configuration.storage !== "supabase") {
    return synthetic(
      "This deployment stores dashboard data in fixtures, so traffic figures stay synthetic.",
    );
  }

  // A Supabase session is what RLS scopes the read to. Without this check a
  // preview session would query the table with no tenant filter behind it.
  if (auth.mode !== "supabase") {
    return synthetic(
      "Live storage needs a Supabase session; this one is not, so traffic figures stay synthetic.",
    );
  }

  // Tenant isolation, re-checked rather than assumed. `auth.access.clientId` is
  // only safe to query with because the session was resolved against this exact
  // brand; if those two ever drift, one brand's GA4 rows would render under
  // another brand's name, currency and timezone. Unreachable in correct
  // operation, and refused rather than served if it is ever reached.
  if (auth.access.clientSlug !== account.slug) {
    return privateJson(
      { error: "The session does not match the requested client." },
      { status: 403 },
    );
  }

  // Live GA4 traffic replaces the synthetic figures, and only when the stored
  // rows pass the bridge's quality gate: every selected day covered exactly
  // once, no unexpected provisional day, no malformed row. Anything short of
  // that leaves the snapshot visibly synthetic rather than mixing measured and
  // invented days inside one total.
  //
  // The whole path fails soft. An unreachable database, a missing migration, or
  // a brand with no GA4 property returns the synthetic snapshot instead of an
  // error: a store page that will not render is worse than one that is honest
  // about still being on fixtures.
  try {
    const ga4Rows = await readGa4DailyMetrics(auth.access.clientId, range.value);
    const hydration = applyGa4Hydration(syntheticSnapshot, ga4Rows);

    return privateJson({
      ...hydration.snapshot,
      // Sibling keys, never nested into the snapshot: the shell reads the
      // payload as the snapshot itself, and an unknown extra key is ignored
      // rather than breaking it. They are what let the page caption say whether
      // the traffic figures are measured or synthetic.
      ga4: hydration.summary,
      modeStatus: {
        ...modeStatus,
        liveTrafficApplied: hydration.summary.hydrated,
        reason: hydration.summary.reason,
      },
    });
  } catch {
    return synthetic(
      "Stored GA4 traffic is unavailable, so traffic figures stay synthetic.",
    );
  }
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  // The brand is validated before the session is checked against it. An
  // unknown slug is refused, never coerced to the pilot: coercion is what
  // served Kopi Senja Nusantara rows under every other brand's name.
  const scope = resolveClientScope(params.get("account"));
  if (!scope.ok) {
    return privateJson({ error: scope.message }, { status: 400 });
  }

  const auth = await resolveAuthContext(scope.clientSlug);
  if (!auth.ok) return authFailureResponse(auth);

  const account = resolveAccount(scope.clientSlug);
  const defaultRange = resolveTimeframe(
    "14d",
    currentDateInTimeZone(account.timezone),
  );

  return snapshotResponse(
    auth.context,
    scope.clientSlug,
    params.get("start") ?? defaultRange?.start,
    params.get("end") ?? defaultRange?.end,
    {
      compare: params.get("compare"),
      compareStart: params.get("compareStart"),
      compareEnd: params.get("compareEnd"),
    },
    parseDataMode(params.get("mode")),
  );
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return privateJson(
      { error: "Request origin is not allowed." },
      { status: 403 },
    );
  }

  let body: StoreRefreshRequest;

  try {
    const parsed: unknown = await request.json();

    // A JSON body may legally be a string, a number or null. Reading `.account`
    // off one of those would throw inside the handler instead of answering 400.
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return privateJson(
        { error: "Request body must be a JSON object." },
        { status: 400 },
      );
    }

    body = parsed as StoreRefreshRequest;
  } catch {
    return privateJson(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  // The brand is resolved from the body before the session is checked against
  // it, so the permission check below applies to the brand actually acted on.
  const scope = resolveClientScope(body.account);
  if (!scope.ok) {
    return privateJson({ error: scope.message }, { status: 400 });
  }

  const auth = await resolveAuthContext(scope.clientSlug);
  if (!auth.ok) return authFailureResponse(auth);
  if (!hasPermission(auth.context.access.role, "sync:trigger")) {
    return privateJson(
      { error: "Your role cannot trigger a store data refresh." },
      { status: 403 },
    );
  }

  return snapshotResponse(
    auth.context,
    scope.clientSlug,
    body.start,
    body.end,
    {
      compare: body.compare,
      compareStart: body.compareStart,
      compareEnd: body.compareEnd,
    },
    parseDataMode(body.mode),
    new Date(),
  );
}
