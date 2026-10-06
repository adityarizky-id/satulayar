import { NextRequest } from "next/server";

import { recordAuditEvent } from "@/lib/audit/activity-log";
import { privateJson } from "@/lib/auth/http";
import { loadGoogleAdsConfig } from "@/lib/connectors/google-ads-config";
import { resolveLiveSyncGate } from "@/lib/connectors/health";
import { persistGa4Sync } from "@/lib/connectors/ga4-sync";
import { loadMetaAdsConfig } from "@/lib/connectors/meta-ads-config";
import {
  isAuthorizedScheduledRequest,
  resolveScheduledImpressionShareWindow,
  resolveScheduledSyncWindow,
  SCHEDULED_IMPRESSION_SHARE_LOOKBACK_DAYS,
  SCHEDULED_SYNC_LOOKBACK_DAYS,
} from "@/lib/connectors/scheduled-sync";
import { isDisclosureOnlyIssue } from "@/lib/dashboard/data-quality";
import { ACCOUNT_OPTIONS, resolveAccount } from "@/lib/dashboard/accounts";
import type {
  DataQualityIssue,
  DataStatus,
  DateRange,
  Platform,
  TimezoneAlignment,
} from "@/lib/dashboard/types";
import { getDashboardDataConfiguration } from "@/lib/dashboard/validation";
import { persistLiveSync, resolveClientIdBySlug } from "@/lib/supabase/server";

export const runtime = "nodejs";
/** A seven-day two-platform pull is slower than the default budget allows. */
export const maxDuration = 300;

/**
 * One brand's outcome. Reported per client rather than merged into a single
 * total: five brands sharing one number would hide which of them actually
 * failed, and a scheduled job nobody can diagnose gets ignored.
 */
interface ScheduledClientResult {
  clientSlug: string;
  outcome: "succeeded" | "partial" | "skipped" | "failed";
  safeMessage: string;
  requestedRange?: DateRange;
  impressionShareRange?: DateRange;
  platforms?: Exclude<Platform, "all">[];
  dataStatus?: DataStatus;
  accountRowsUpserted?: number;
  campaignRowsUpserted?: number;
  campaignAttributesUpserted?: number;
  searchTermRowsUpserted?: number;
  deviceRowsUpserted?: number;
  impressionSharePeriodRowsUpserted?: number;
  entityRowsUpserted?: number;
  geoRowsUpserted?: number;
  audienceRowsUpserted?: number;
  warnings?: string[];
  errors?: string[];
  qualityIssues?: DataQualityIssue[];
  timezoneAlignment?: TimezoneAlignment;
  disclosureOnly?: boolean;
  ga4?: {
    outcome: string;
    rowsUpserted: number;
    safeMessage: string;
    warnings: string[];
  };
}

/**
 * Daily unattended refresh, invoked by Vercel Cron.
 *
 * Scope is deliberately narrow. It reads the advertising platforms read-only
 * and upserts into this project's own `daily_metrics`; it never sends anything
 * outward, changes a campaign or budget, or deletes a row, so it needs no
 * per-run approval. Every guard below fails closed, and turning the schedule
 * off in `vercel.json` (or clearing `CRON_SECRET`) is the whole rollback.
 */
export async function GET(request: NextRequest) {
  if (!isAuthorizedScheduledRequest(request.headers.get("authorization"))) {
    // Deliberately identical for a wrong secret and a missing one.
    return privateJson({ error: "Not authorised." }, { status: 401 });
  }

  const configuration = getDashboardDataConfiguration();
  if (configuration.mode !== "live" || configuration.storage !== "supabase") {
    return privateJson(
      {
        error:
          "The scheduled refresh runs only against the live connectors with Supabase storage.",
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

  // Resolve readiness per brand and platform. Google OAuth is granted at the
  // shared MCC, so four brands can be live through that manager grant without
  // each duplicating the same refresh token in `connector_tokens`. Selecting
  // only slugs that own a token row silently excluded those brands. The config
  // loaders preserve the stronger boundary: a platform is scheduled only when
  // its own account mapping and credential path resolve for this exact brand.
  const connectedClients = await Promise.all(
    ACCOUNT_OPTIONS.map(async (account) => {
      const platforms: Exclude<Platform, "all">[] = [];

      if (account.platforms.includes("google")) {
        const google = await loadGoogleAdsConfig(account.slug);
        if (google.ok) platforms.push("google");
      }

      if (account.platforms.includes("meta")) {
        const meta = await loadMetaAdsConfig(account.slug);
        if (meta.ok) platforms.push("meta");
      }

      return { clientSlug: account.slug, platforms };
    }),
  ).then((items) => items.filter((item) => item.platforms.length > 0));

  if (connectedClients.length === 0) {
    // Nothing is connected yet. That is a known state, not a failure: reporting
    // it as an error would make an empty deployment page someone every morning.
    return privateJson(
      {
        clients: [],
        lookbackDays: SCHEDULED_SYNC_LOOKBACK_DAYS,
        safeMessage:
          "No client has a resolvable connector configuration, so the scheduled refresh had nothing to pull.",
      },
      { status: 200 },
    );
  }

  const clients: ScheduledClientResult[] = [];

  for (const connected of connectedClients) {
    const { clientSlug, platforms } = connected;
    // One brand per iteration, each in its own try. A brand whose credential
    // expired, whose account mapping is missing, or whose platform is down must
    // not stop the brands after it in the list.
    try {
      const account = resolveAccount(clientSlug);
      // The window is resolved per brand, because each reports in its own
      // timezone: yesterday in Jakarta is not always yesterday in Makassar.
      const range = resolveScheduledSyncWindow(account.timezone);
      const impressionShareRange = platforms.includes("google")
        ? resolveScheduledImpressionShareWindow(account.timezone)
        : undefined;
      const clientId = await resolveClientIdBySlug(clientSlug);

      if (!clientId) {
        clients.push({
          clientSlug,
          outcome: "skipped",
          safeMessage:
            "This client is connected but not provisioned in the database, so nothing was pulled.",
        });
        continue;
      }

      const result = await persistLiveSync({
        clientId,
        clientSlug,
        // No human triggered this run. `sync_jobs.requested_by` stays null
        // rather than borrowing an operator's identity for a machine action.
        requestedBy: null,
        range,
        impressionShareRange,
        platforms,
        trigger: "scheduled",
      });

      // GA4 runs after the advertising pull and reports separately. The two
      // describe different things, so a GA4 outage must not discard an ad
      // refresh that already landed.
      const ga4 = await persistGa4Sync({
        clientId,
        clientSlug,
        range,
        currency: account.currency,
      });

      // An unattended run leaves the same trail as a human one, with no actor.
      await recordAuditEvent({
        clientId,
        actorUserId: null,
        action: "sync.scheduled",
        subject: `${range.start} to ${range.end}`,
        outcome: result.errors.length > 0 ? "failed" : "succeeded",
        recordCount: result.accountRowsUpserted + result.campaignRowsUpserted,
        detail: {
          lookbackDays: SCHEDULED_SYNC_LOOKBACK_DAYS,
          impressionShareLookbackDays:
            SCHEDULED_IMPRESSION_SHARE_LOOKBACK_DAYS,
          impressionShareRange,
          dataStatus: result.dataStatus,
          ga4Outcome: ga4.outcome,
          ga4RowsUpserted: ga4.rowsUpserted,
          clientSlug,
        },
      });

      clients.push({
        clientSlug,
        outcome: result.errors.length > 0 ? "partial" : "succeeded",
        requestedRange: range,
        impressionShareRange,
        platforms,
        dataStatus: result.dataStatus,
        accountRowsUpserted: result.accountRowsUpserted,
        campaignRowsUpserted: result.campaignRowsUpserted,
        campaignAttributesUpserted: result.campaignAttributesUpserted,
        searchTermRowsUpserted: result.searchTermRowsUpserted,
        deviceRowsUpserted: result.deviceRowsUpserted,
        impressionSharePeriodRowsUpserted: result.impressionSharePeriodRowsUpserted,
        entityRowsUpserted: result.entityRowsUpserted,
        geoRowsUpserted: result.geoRowsUpserted,
        audienceRowsUpserted: result.audienceRowsUpserted,
        warnings: result.warnings,
        errors: result.errors,
        qualityIssues: result.qualityIssues,
        timezoneAlignment: result.timezoneAlignment,
        // A run whose only issue is the BST disclaimer landed every row.
        disclosureOnly: result.qualityIssues.every(isDisclosureOnlyIssue),
        ga4: {
          outcome: ga4.outcome,
          rowsUpserted: ga4.rowsUpserted,
          safeMessage: ga4.safeMessage,
          warnings: ga4.warnings,
        },
        safeMessage: result.job.safeMessage,
      });
    } catch {
      clients.push({
        clientSlug,
        outcome: "failed",
        safeMessage:
          "This client failed safely. Its job was closed and no partial period was published; other clients were unaffected.",
      });
    }
  }

  return privateJson(
    {
      clients,
      clientsAttempted: clients.length,
      clientsSucceeded: clients.filter((item) => item.outcome === "succeeded").length,
      lookbackDays: SCHEDULED_SYNC_LOOKBACK_DAYS,
      impressionShareLookbackDays: SCHEDULED_IMPRESSION_SHARE_LOOKBACK_DAYS,
    },
    { status: 200 },
  );
}
