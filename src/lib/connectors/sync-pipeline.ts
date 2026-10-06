import {
  evaluateDataQuality,
  isDisclosureOnlyIssue,
} from "@/lib/dashboard/data-quality";
import type { DailyMetric, DataStatus, DateRange, Platform, SyncJobStatus } from "@/lib/dashboard/types";
import { GoogleAdsApiClient } from "./google-ads-api-client";
import {
  loadGoogleAdsConfig,
  type GoogleAdsConfigResolution,
} from "./google-ads-config";
import { MetaAdsApiClient } from "./meta-ads-api-client";
import {
  loadMetaAdsConfig,
  type MetaAdsConfigResolution,
} from "./meta-ads-config";
import { MockAdsConnector } from "./mock";
import {
  ConnectorFailure,
  type AdCampaignRecord,
  type AdEntityDailyRecord,
  type AudienceDailyRecord,
  type DeviceDailyRecord,
  type GeoDailyRecord,
  type ImpressionSharePeriodRecord,
  type ReadOnlyAdsConnector,
  type SearchTermDailyRecord,
} from "./types";

export interface SyncPipelineOptions {
  clientId: string;
  /**
   * Brand slug. Required for a live pull: the connector for each platform is
   * built from this brand's own account mapping, and without it there is no
   * account that is safe to read.
   */
  clientSlug?: string;
  accountKey: string;
  range: DateRange;
  /** Google-only period snapshot; daily facts continue to use `range`. */
  impressionShareRange?: DateRange;
  platforms: Exclude<Platform, "all">[];
  mode?: "mock" | "live";
}

export interface SyncPipelineDependencies {
  /** Injected in tests; production reads the stored credential registry. */
  loadGoogleAdsConfig?: (clientSlug: string) => Promise<GoogleAdsConfigResolution>;
  loadMetaAdsConfig?: (clientSlug: string) => Promise<MetaAdsConfigResolution>;
}

export interface SyncPipelineExecutionResult {
  jobId: string;
  status: SyncJobStatus;
  recordsProcessed: number;
  warnings: string[];
  errors: string[];
  latencyMs: number;
  dataStatus: DataStatus;
  /** Account-level rows. These are the only rows KPIs are computed from. */
  rows: DailyMetric[];
  /** Campaign-level rows for the same range, persisted but never aggregated. */
  campaignRows: DailyMetric[];
  /** Campaign attributes (channel type, status) seen in the range. */
  campaigns: AdCampaignRecord[];
  /** Google search query rows for the range. */
  searchTermRows: SearchTermDailyRecord[];
  /** Google per-device rows for the range. */
  deviceRows: DeviceDailyRecord[];
  /** Google ad group and asset group rows for the range. */
  entityRows: AdEntityDailyRecord[];
  /** Google country and region rows for the range. */
  geoRows: GeoDailyRecord[];
  /** Google audience segment rows for the range. */
  audienceRows: AudienceDailyRecord[];
  /** Google impression share for the range as a whole, not rolled up from days. */
  impressionSharePeriodRows: ImpressionSharePeriodRecord[];
  /** Per-platform outcome, so the caller can record connector health. */
  platformOutcomes: SyncPlatformOutcome[];
}

export interface SyncPlatformOutcome {
  platform: Exclude<Platform, "all">;
  providerId: string;
  outcome: "succeeded" | "failed" | "skipped";
  rowCount: number;
  safeMessage: string;
}

export class SyncPipeline {
  constructor(private readonly dependencies: SyncPipelineDependencies = {}) {}

  /**
   * Builds the connector for one platform of one brand.
   *
   * Live connectors are never built from shared, unsuffixed settings for an
   * arbitrary brand: that is how a scheduled run would read the pilot account
   * and store it under another brand. Anything that cannot be tied to this
   * brand throws, and the caller records it as a failed platform.
   */
  private async getConnector(
    platform: Exclude<Platform, "all">,
    mode: "mock" | "live",
    clientSlug?: string,
  ): Promise<ReadOnlyAdsConnector> {
    if (mode !== "live") return new MockAdsConnector(platform);

    const slug = clientSlug?.trim();
    if (!slug) {
      throw new ConnectorFailure(
        "configuration-error",
        "Live sync was requested without a brand, so no account can be selected safely. Sync refused.",
        false,
      );
    }

    if (platform === "google") {
      const load = this.dependencies.loadGoogleAdsConfig ?? ((target: string) => loadGoogleAdsConfig(target));
      const resolution = await load(slug);
      if (!resolution.ok) {
        throw new ConnectorFailure("configuration-error", resolution.safeMessage, false);
      }
      return new GoogleAdsApiClient(resolution.config);
    }

    if (platform === "meta") {
      const load =
        this.dependencies.loadMetaAdsConfig ??
        ((target: string) => loadMetaAdsConfig(target));
      const resolution = await load(slug);
      if (!resolution.ok) {
        throw new ConnectorFailure(
          "configuration-error",
          resolution.safeMessage,
          false,
        );
      }
      return new MetaAdsApiClient(resolution.config);
    }

    return new MockAdsConnector(platform);
  }

  async runSync(options: SyncPipelineOptions): Promise<SyncPipelineExecutionResult> {
    const startTime = Date.now();
    const jobId = `sync-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const warnings: string[] = [];
    const errors: string[] = [];
    const combinedRows: DailyMetric[] = [];
    const combinedCampaignRows: DailyMetric[] = [];
    const combinedCampaigns: AdCampaignRecord[] = [];
    const combinedSearchTermRows: SearchTermDailyRecord[] = [];
    const combinedDeviceRows: DeviceDailyRecord[] = [];
    const combinedEntityRows: AdEntityDailyRecord[] = [];
    const combinedGeoRows: GeoDailyRecord[] = [];
    const combinedAudienceRows: AudienceDailyRecord[] = [];
    const combinedImpressionSharePeriodRows: ImpressionSharePeriodRecord[] = [];
    const platformOutcomes: SyncPlatformOutcome[] = [];
    const mode = options.mode ?? "live";

    for (const platform of options.platforms) {
      let providerId = `${platform}-direct-api`;
      try {
        const connector = await this.getConnector(platform, mode, options.clientSlug);
        providerId = connector.providerId;
        const health = await connector.health();
        if (!health.available || !health.authenticated) {
          if (mode === "live") {
            errors.push(
              `[${platform}] Direct API credentials missing or unauthenticated (${health.safeMessage}). Fail-closed in live mode.`,
            );
            platformOutcomes.push({
              platform,
              providerId,
              outcome: "failed",
              rowCount: 0,
              safeMessage: health.safeMessage,
            });
          } else {
            warnings.push(
              `[${platform}] Direct API unauthenticated or unavailable (${health.safeMessage}). Falling back to mock connector.`,
            );
            const fallback = new MockAdsConnector(platform);
            const res = await fallback.fetchDailyMetrics({
              clientId: options.clientId,
              accountKey: options.accountKey,
              range: options.range,
            });
            combinedRows.push(...res.rows);
            warnings.push(...res.warnings);
            platformOutcomes.push({
              platform,
              providerId: fallback.providerId,
              outcome: "succeeded",
              rowCount: res.rows.length,
              safeMessage: `Synthetic fallback served ${res.rows.length} row(s).`,
            });
          }
        } else {
          const res = await connector.fetchDailyMetrics({
            clientId: options.clientId,
            accountKey: options.accountKey,
            range: options.range,
            impressionShareRange: options.impressionShareRange,
          });
          combinedRows.push(...res.rows);
          combinedCampaignRows.push(...(res.campaignRows ?? []));
          combinedCampaigns.push(...(res.campaigns ?? []));
          combinedSearchTermRows.push(...(res.searchTermRows ?? []));
          combinedDeviceRows.push(...(res.deviceRows ?? []));
          combinedEntityRows.push(...(res.entityRows ?? []));
          combinedGeoRows.push(...(res.geoRows ?? []));
          combinedAudienceRows.push(...(res.audienceRows ?? []));
          combinedImpressionSharePeriodRows.push(
            ...(res.impressionSharePeriodRows ?? []),
          );
          warnings.push(...res.warnings);
          platformOutcomes.push({
            platform,
            providerId: res.providerId,
            outcome: res.rows.length > 0 ? "succeeded" : "skipped",
            rowCount: res.rows.length,
            safeMessage:
              res.attempts[res.attempts.length - 1]?.safeMessage ??
              `${res.rows.length} row(s) returned.`,
          });
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`[${platform}] Connector failure: ${message}`);
        platformOutcomes.push({
          platform,
          providerId,
          outcome: "failed",
          rowCount: 0,
          safeMessage: message,
        });
      }
    }

    // Score against the platforms that were actually requested. Leaving this
    // at the default "all" made a deliberate Google-only refresh report a
    // blocking `platform-missing` for Meta, which then downgraded a complete,
    // healthy pull to `partial` and emitted a gate-failure error that the
    // caller's own re-scoring contradicted.
    const scope: Platform =
      options.platforms.length === 1 ? options.platforms[0] : "all";
    const qualityReport = evaluateDataQuality(combinedRows, options.range, scope);
    let finalStatus: SyncJobStatus = "succeeded";
    let dataStatus: DataStatus = qualityReport.status;

    if (errors.length > 0 && combinedRows.length === 0) {
      finalStatus = "failed";
      dataStatus = "blocked";
    } else if (qualityReport.issues.some((issue) => issue.severity === "blocking")) {
      finalStatus = "failed";
      dataStatus = "blocked";
      errors.push("Data Quality Gate failed: blocking issues detected (fail-closed activated).");
    } else if (
      // A disclosure-only warning (the UK GMT/BST offset) caveats rows that
      // arrived in full; it is not lost coverage and must not read as partial.
      qualityReport.issues.some(
        (issue) => issue.severity === "warning" && !isDisclosureOnlyIssue(issue),
      ) ||
      errors.length > 0
    ) {
      finalStatus = "partial";
      dataStatus = "partial";
    }

    const latencyMs = Date.now() - startTime;

    return {
      jobId,
      status: finalStatus,
      recordsProcessed: combinedRows.length,
      warnings,
      errors,
      latencyMs,
      dataStatus,
      rows: combinedRows,
      campaignRows: combinedCampaignRows,
      campaigns: combinedCampaigns,
      searchTermRows: combinedSearchTermRows,
      deviceRows: combinedDeviceRows,
      entityRows: combinedEntityRows,
      geoRows: combinedGeoRows,
      audienceRows: combinedAudienceRows,
      impressionSharePeriodRows: combinedImpressionSharePeriodRows,
      platformOutcomes,
    };
  }
}
