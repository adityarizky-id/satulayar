import { NextRequest } from "next/server";

import { recordAuditEvent } from "@/lib/audit/activity-log";
import { hasPermission } from "@/lib/auth/authorization";
import { resolveClientScope } from "@/lib/auth/client-scope";
import {
  authFailureResponse,
  isSameOriginRequest,
  privateJson,
} from "@/lib/auth/http";
import { resolveAuthContext } from "@/lib/auth/session";
import {
  BACKFILL_LOOKBACK_OPTIONS,
  isBackfillLookback,
  resolveBackfillWindow,
} from "@/lib/connectors/backfill";
import { persistGa4Sync } from "@/lib/connectors/ga4-sync";
import { resolveLiveSyncGate } from "@/lib/connectors/health";
import { resolveAccount } from "@/lib/dashboard/accounts";
import type { Platform } from "@/lib/dashboard/types";
import { getDashboardDataConfiguration } from "@/lib/dashboard/validation";
import { persistLiveSync } from "@/lib/supabase/server";

export const runtime = "nodejs";
/** Ninety days across two platforms outruns the default budget. */
export const maxDuration = 300;

interface BackfillRequest {
  lookback?: unknown;
  platform?: unknown;
  client?: unknown;
}

/**
 * Re-pulls a trailing window on demand.
 *
 * This exists because the scheduled job only reaches back seven days, so
 * repairing anything older previously required an engineer. It is the same
 * ingestion path as the daily refresh, run over a longer window: read-only
 * against the platforms, upsert-only into this project's own tables, and safe
 * to run twice because every destination conflicts on a stable key.
 */
export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return privateJson({ error: "Request origin is not allowed." }, { status: 403 });
  }

  let body: BackfillRequest;
  try {
    body = (await request.json()) as BackfillRequest;
  } catch {
    return privateJson({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  // The brand decides which credential is used and whose rows are written, so
  // it is validated first and the session is checked against it.
  const scope = resolveClientScope(body.client);
  if (!scope.ok) {
    return privateJson({ error: scope.message }, { status: 400 });
  }

  const auth = await resolveAuthContext(scope.clientSlug);
  if (!auth.ok) return authFailureResponse(auth);
  if (!hasPermission(auth.context.access.role, "sync:trigger")) {
    return privateJson(
      { error: "Your role cannot trigger a backfill." },
      { status: 403 },
    );
  }

  // Fixed allowlist. Anything else is refused rather than clamped, so a typo
  // cannot quietly become a different request than the operator intended.
  if (!isBackfillLookback(body.lookback)) {
    return privateJson(
      {
        error: `Lookback must be one of: ${BACKFILL_LOOKBACK_OPTIONS.join(", ")}.`,
      },
      { status: 400 },
    );
  }

  const platform: Platform =
    body.platform === "meta" || body.platform === "google" ? body.platform : "all";
  const platforms = platform === "all" ? (["meta", "google"] as const) : [platform];

  const configuration = getDashboardDataConfiguration();
  if (configuration.mode !== "live" || configuration.storage !== "supabase") {
    return privateJson(
      {
        error:
          "A backfill only runs against the live connectors with Supabase storage.",
      },
      { status: 503 },
    );
  }

  const gate = resolveLiveSyncGate();
  if (!gate.unlocked) {
    return privateJson(
      { error: `Live connector sync is locked. ${gate.reason}` },
      { status: 503 },
    );
  }

  if (auth.context.mode !== "supabase") {
    return privateJson(
      {
        error:
          "A backfill requires Supabase authentication. Check the dashboard environment.",
      },
      { status: 503 },
    );
  }

  const account = resolveAccount(scope.clientSlug);
  const range = resolveBackfillWindow(body.lookback, account.timezone);

  try {
    const result = await persistLiveSync({
      clientId: auth.context.access.clientId,
      clientSlug: scope.clientSlug,
      requestedBy: auth.context.userId,
      range,
      platforms: [...platforms],
      trigger: "operator",
    });

    // The same window is re-read from GA4. Both destinations upsert on a
    // stable key, so a repeated backfill corrects days rather than duplicating.
    const ga4 = await persistGa4Sync({
      clientId: auth.context.access.clientId,
      clientSlug: scope.clientSlug,
      range,
      currency: account.currency,
    });

    await recordAuditEvent({
      clientId: auth.context.access.clientId,
      actorUserId: auth.context.userId,
      actorEmail: auth.context.email,
      actorRole: auth.context.access.role,
      action: "sync.backfill",
      subject: `${range.start} to ${range.end}`,
      outcome: result.errors.length > 0 ? "failed" : "succeeded",
      recordCount: result.accountRowsUpserted + result.campaignRowsUpserted,
      detail: {
        lookback: body.lookback,
        platforms: [...platforms],
        dataStatus: result.dataStatus,
        ga4Outcome: ga4.outcome,
        ga4RowsUpserted: ga4.rowsUpserted,
        clientSlug: scope.clientSlug,
      },
    });

    return privateJson(
      {
        ...result.job,
        lookback: body.lookback,
        requestedRange: range,
        dataStatus: result.dataStatus,
        accountRowsUpserted: result.accountRowsUpserted,
        campaignRowsUpserted: result.campaignRowsUpserted,
        warnings: result.warnings,
        errors: result.errors,
        qualityIssues: result.qualityIssues,
        timezoneAlignment: result.timezoneAlignment,
        ga4: {
          outcome: ga4.outcome,
          rowsUpserted: ga4.rowsUpserted,
          safeMessage: ga4.safeMessage,
          warnings: ga4.warnings,
        },
      },
      { status: 202 },
    );
  } catch {
    await recordAuditEvent({
      clientId: auth.context.access.clientId,
      actorUserId: auth.context.userId,
      actorEmail: auth.context.email,
      actorRole: auth.context.access.role,
      action: "sync.backfill",
      subject: `${range.start} to ${range.end}`,
      outcome: "failed",
      detail: {
        lookback: body.lookback,
        platforms: [...platforms],
        clientSlug: scope.clientSlug,
      },
    });

    return privateJson(
      {
        error:
          "The backfill failed safely. The job was closed and no partial period was published.",
      },
      { status: 503 },
    );
  }
}
