import { filterMetricRows } from "@/lib/dashboard/kpi";
import { fixtureRows } from "@/lib/dashboard/fixtures";
import type {
  ConnectorRequest,
  ConnectorResult,
  ReadOnlyAdsConnector,
} from "@/lib/connectors/types";
import type { Platform } from "@/lib/dashboard/types";

export class MockAdsConnector implements ReadOnlyAdsConnector {
  readonly providerId: string;
  readonly providerKind = "mock" as const;
  readonly mode = "mock" as const;

  constructor(
    readonly platform: Exclude<Platform, "all">,
  ) {
    this.providerId = `${platform}-mock`;
  }

  async health() {
    return {
      providerId: this.providerId,
      providerKind: this.providerKind,
      available: true,
      authenticated: false,
      readOnly: true,
      safeMessage: "Fixture connector is available; no live credentials loaded.",
    };
  }

  async fetchDailyMetrics(
    request: ConnectorRequest,
  ): Promise<ConnectorResult> {
    return {
      platform: this.platform,
      rows: filterMetricRows(fixtureRows, request.range, this.platform),
      providerId: this.providerId,
      sourceQueryVersion: "fixture-v1",
      coveragePercent: 100,
      warnings: ["Synthetic preview data only."],
      attempts: [
        {
          providerId: this.providerId,
          outcome: "succeeded",
          safeMessage: "Fixture data returned.",
        },
      ],
    };
  }
}
