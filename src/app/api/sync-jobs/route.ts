import { randomUUID } from "node:crypto";

import { NextRequest } from "next/server";

import { hasPermission } from "@/lib/auth/authorization";
import { resolveActiveClientSlug } from "@/lib/auth/client-scope";
import {
  authFailureResponse,
  isSameOriginRequest,
  privateJson,
} from "@/lib/auth/http";
import { resolveAuthContext } from "@/lib/auth/session";
import { recordAuditEvent } from "@/lib/audit/activity-log";
import { resolveLiveSyncGate } from "@/lib/connectors/health";
import { resolveManualSyncWindow } from "@/lib/connectors/scheduled-sync";
import {
  ACCOUNT_COOKIE,
  resolveAccount,
  resolvePlatformForAccount,
} from "@/lib/dashboard/accounts";
import type { DateRange, Platform, SyncJob } from "@/lib/dashboard/types";
import {
  getDashboardDataConfiguration,
  validateDateRange,
} from "@/lib/dashboard/validation";
import { persistFixtureSync, persistLiveSync } from "@/lib/supabase/server";

export const runtime = "nodejs";

interface SyncJobRequest {
  start?: unknown;
  end?: unknown;
  platform?: unknown;
  account?: unknown;
  clientSlug?: unknown;
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return privateJson(
      { error: "Request origin is not allowed." },
      { status: 403 },
    );
  }

  let body: SyncJobRequest;

  try {
    body = (await request.json()) as SyncJobRequest;
  } catch {
    return privateJson(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const scope = resolveActiveClientSlug({
    requested:
      typeof body.account === "string"
        ? body.account
        : typeof body.clientSlug === "string"
          ? body.clientSlug
          : request.nextUrl.searchParams.get("account"),
    cookie: request.cookies.get(ACCOUNT_COOKIE)?.value,
  });
  if (!scope.ok) {
    return privateJson({ error: scope.message }, { status: 400 });
  }

  const auth = await resolveAuthContext(scope.clientSlug);
  if (!auth.ok) return authFailureResponse(auth);
  if (!hasPermission(auth.context.access.role, "sync:trigger")) {
    return privateJson(
      { error: "Your role cannot trigger a data refresh." },
      { status: 403 },
    );
  }

  const requestedRange = validateDateRange(body.start, body.end);
  if (!requestedRange.ok) {
    return privateJson(
      { error: requestedRange.message },
      { status: 400 },
    );
  }

  const account = resolveAccount(scope.clientSlug);
  const requestedPlatform: Platform =
    body.platform === "meta" || body.platform === "google"
      ? body.platform
      : "all";
  const platform = resolvePlatformForAccount(account, requestedPlatform);
  const platforms =
    platform === "all" ? (["meta", "google"] as const) : [platform];
  let manualRange: DateRange;
  try {
    manualRange = resolveManualSyncWindow(
      requestedRange.value,
      account.timezone,
    );
  } catch (error) {
    return privateJson(
      {
        error:
          error instanceof Error
            ? error.message
            : "Manual sync window is invalid.",
      },
      { status: 400 },
    );
  }

  const range = validateDateRange(manualRange.start, manualRange.end);
  if (!range.ok) {
    return privateJson({ error: range.message }, { status: 400 });
  }
  const configuration = getDashboardDataConfiguration();

  if (configuration.mode === "live") {
    const gate = resolveLiveSyncGate();
    if (!gate.unlocked) {
      return privateJson(
        {
          error: `Live connector sync is locked. ${gate.reason}`,
        },
        { status: 503 },
      );
    }

    if (auth.context.mode !== "supabase") {
      return privateJson(
        {
          error:
            "Live sync requires Supabase authentication. Check the dashboard environment.",
        },
        { status: 503 },
      );
    }

    try {
      const result = await persistLiveSync({
        clientId: auth.context.access.clientId,
        clientSlug: auth.context.access.clientSlug,
        requestedBy: auth.context.userId,
        range: range.value,
        platforms: [...platforms],
      });

      // Who asked for this refresh, and what came back. The trail records
      // counts and the requested range, never a row or a credential.
      await recordAuditEvent({
        clientId: auth.context.access.clientId,
        actorUserId: auth.context.userId,
        actorEmail: auth.context.email,
        actorRole: auth.context.access.role,
        action: "sync.manual",
        subject: platforms.join(", "),
        outcome: result.errors.length > 0 ? "failed" : "succeeded",
        recordCount: result.accountRowsUpserted + result.campaignRowsUpserted,
        detail: { start: range.value.start, end: range.value.end, dataStatus: result.dataStatus },
      });

      // Warnings and errors here are written by this codebase and by
      // ConnectorFailure, both of which are kept free of credentials and raw
      // provider bodies, so they are safe to return to an authorised operator.
      return privateJson(
        {
          ...result.job,
          dataStatus: result.dataStatus,
          accountRowsUpserted: result.accountRowsUpserted,
          campaignRowsUpserted: result.campaignRowsUpserted,
          warnings: result.warnings,
          errors: result.errors,
          // Codebase-authored copy, codes, dates, and IANA zone names only, so
          // the UI can show the timezone disclaimer right after a refresh.
          qualityIssues: result.qualityIssues,
          timezoneAlignment: result.timezoneAlignment,
        },
        { status: 202 },
      );
    } catch {
      return privateJson(
        {
          error:
            "Live sync failed safely. The job was closed and no partial period was published.",
        },
        { status: 503 },
      );
    }
  }

  if (configuration.storage === "supabase") {
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
      const job = await persistFixtureSync({
        clientId: auth.context.access.clientId,
        requestedBy: auth.context.userId,
        range: range.value,
        platforms: [...platforms],
      });
      return privateJson(job, { status: 202 });
    } catch {
      return privateJson(
        {
          error:
            "Dummy sync failed safely. Check the server worker secret and Supabase setup.",
        },
        { status: 503 },
      );
    }
  }

  const now = new Date();
  const job: SyncJob = {
    id: `mock-${now.getTime()}-${range.value.start}-${range.value.end}-${platform}-${randomUUID().slice(0, 8)}`,
    status: "queued",
    requestedRange: range.value,
    platforms: [...platforms],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    safeMessage: "Fixture refresh queued. No external connector was called.",
  };

  return privateJson(job, { status: 202 });
}
