import assert from "node:assert/strict";
import test from "node:test";

import { FallbackConnectorGateway } from "../src/lib/connectors/fallback-gateway";
import { getProviderPriority } from "../src/lib/connectors/provider-catalog";
import { RemoteMcpToolClient } from "../src/lib/connectors/remote-mcp-client";
import {
  ConnectorFailure,
  type ConnectorHealth,
  type ConnectorRequest,
  type ConnectorResult,
  type ReadOnlyAdsConnector,
} from "../src/lib/connectors/types";
import type { DailyMetric } from "../src/lib/dashboard/types";

const request: ConnectorRequest = {
  clientId: "pilot-client",
  accountKey: "pilot-account",
  range: { start: "2026-07-01", end: "2026-07-02" },
};

const metric: DailyMetric = {
  date: "2026-07-01",
  clientId: "pilot",
  accountId: "redacted",
  platform: "meta",
  currency: "GBP",
  accountTimezone: "Europe/London",
  spend: 100,
  impressions: 1_000,
  clicks: 100,
  landingPageViews: 80,
  registrations: 10,
  purchases: 4,
  platformConversionValue: 300,
  actualPurchaseRevenue: 240,
  sourceConnector: "meta-community-mcp",
  sourceQueryVersion: "test-v1",
  syncedAt: "2026-07-18T00:00:00.000Z",
  isProvisional: false,
};

class StubConnector implements ReadOnlyAdsConnector {
  readonly platform = "meta" as const;
  readonly providerKind = "community-mcp" as const;
  readonly mode = "live" as const;

  constructor(
    readonly providerId: string,
    private readonly healthResult: ConnectorHealth,
    private readonly fetchResult: ConnectorResult | ConnectorFailure,
  ) {}

  async health() {
    return this.healthResult;
  }

  async fetchDailyMetrics() {
    if (this.fetchResult instanceof ConnectorFailure) {
      throw this.fetchResult;
    }

    return this.fetchResult;
  }
}

function healthy(providerId: string): ConnectorHealth {
  return {
    providerId,
    providerKind: "community-mcp",
    available: true,
    authenticated: true,
    readOnly: true,
    safeMessage: "Ready.",
  };
}

function result(providerId: string): ConnectorResult {
  return {
    platform: "meta",
    rows: [metric],
    providerId,
    sourceQueryVersion: "test-v1",
    coveragePercent: 100,
    warnings: [],
    attempts: [],
  };
}

test("gateway uses the first healthy provider", async () => {
  const official = new StubConnector(
    "meta-official-mcp",
    healthy("meta-official-mcp"),
    result("meta-official-mcp"),
  );
  const fallback = new StubConnector(
    "meta-community-mcp",
    healthy("meta-community-mcp"),
    result("meta-community-mcp"),
  );
  const gateway = new FallbackConnectorGateway("meta", [official, fallback]);

  const response = await gateway.fetchDailyMetrics(request);

  assert.equal(response.providerId, "meta-official-mcp");
  assert.deepEqual(
    response.attempts.map((attempt) => attempt.providerId),
    ["meta-official-mcp"],
  );
});

test("gateway falls back after quota or availability failures", async () => {
  const quotaLimited = new StubConnector(
    "meta-pipeboard",
    healthy("meta-pipeboard"),
    new ConnectorFailure("quota-exceeded", "Provider quota exceeded.", true),
  );
  const community = new StubConnector(
    "meta-community-mcp",
    healthy("meta-community-mcp"),
    result("meta-community-mcp"),
  );
  const gateway = new FallbackConnectorGateway("meta", [
    quotaLimited,
    community,
  ]);

  const response = await gateway.fetchDailyMetrics(request);

  assert.equal(response.providerId, "meta-community-mcp");
  assert.deepEqual(
    response.attempts.map(({ providerId, outcome }) => ({
      providerId,
      outcome,
    })),
    [
      { providerId: "meta-pipeboard", outcome: "failed" },
      { providerId: "meta-community-mcp", outcome: "succeeded" },
    ],
  );
});

test("gateway does not hide data parity failures with a fallback", async () => {
  const invalidData = new StubConnector(
    "meta-official-mcp",
    healthy("meta-official-mcp"),
    new ConnectorFailure(
      "data-parity-failed",
      "Provider data failed parity validation.",
      false,
    ),
  );
  const fallback = new StubConnector(
    "meta-pipeboard",
    healthy("meta-pipeboard"),
    result("meta-pipeboard"),
  );
  const gateway = new FallbackConnectorGateway("meta", [
    invalidData,
    fallback,
  ]);

  await assert.rejects(
    () => gateway.fetchDailyMetrics(request),
    (error: unknown) =>
      error instanceof ConnectorFailure &&
      error.code === "data-parity-failed",
  );
});

test("gateway rejects providers that expose write access", async () => {
  const writeEnabled = new StubConnector(
    "unsafe-provider",
    {
      ...healthy("unsafe-provider"),
      readOnly: false,
    },
    result("unsafe-provider"),
  );
  const gateway = new FallbackConnectorGateway("meta", [writeEnabled]);

  await assert.rejects(
    () => gateway.fetchDailyMetrics(request),
    (error: unknown) =>
      error instanceof ConnectorFailure &&
      error.code === "configuration-error",
  );
});

test("provider catalog keeps official and self-hosted options ahead of Pipeboard", () => {
  assert.deepEqual(
    getProviderPriority("meta").map((provider) => provider.providerId),
    [
      "meta-official-mcp",
      "meta-community-mcp",
      "meta-pipeboard",
    ],
  );
  assert.deepEqual(
    getProviderPriority("google").map((provider) => provider.providerId),
    [
      "google-official-mcp",
      "google-experimental-mcp",
      "google-pipeboard",
    ],
  );
});

test("remote MCP client blocks tools outside the explicit allowlist before network access", async () => {
  const client = new RemoteMcpToolClient({
    providerId: "meta-pipeboard",
    endpoint: "https://meta-ads.mcp.pipeboard.co/",
    allowedTools: ["get_insights"],
  });

  assert.equal(client.isToolAllowed("get_insights"), true);
  assert.equal(client.isToolAllowed("create_campaign"), false);
  await assert.rejects(
    () => client.callAllowedTool("create_campaign", {}),
    (error: unknown) =>
      error instanceof ConnectorFailure &&
      error.code === "configuration-error",
  );
});

test("remote MCP client rejects insecure non-local endpoints", () => {
  assert.throws(
    () =>
      new RemoteMcpToolClient({
        providerId: "unsafe",
        endpoint: "http://example.com/mcp",
        allowedTools: ["get_insights"],
      }),
    (error: unknown) =>
      error instanceof ConnectorFailure &&
      error.code === "configuration-error",
  );
});
