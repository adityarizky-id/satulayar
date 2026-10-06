import { MockAdsConnector } from "@/lib/connectors/mock";
import { getProviderPriority } from "@/lib/connectors/provider-catalog";
import type { ConnectorProviderKind } from "@/lib/connectors/types";
import type {
  DashboardDataMode,
  DashboardStorageMode,
  Platform,
} from "@/lib/dashboard/types";

export type ConnectorCredentialStatus =
  | "not-selected"
  | "configured"
  | "missing";

export interface ConnectorProviderStatus {
  providerId: string;
  providerKind: ConnectorProviderKind;
  priority: number;
  readOnly: true;
  credentialStatus: ConnectorCredentialStatus;
  activation: "active" | "locked";
  endpoint?: string;
  repository?: string;
  safeMessage: string;
}

export interface ConnectorPlatformStatus {
  platform: Exclude<Platform, "all">;
  activeProviderId: string | null;
  status: "mock-ready" | "locked" | "unavailable";
  safeMessage: string;
  providers: ConnectorProviderStatus[];
}


export interface LiveSyncGate {
  unlocked: boolean;
  /** Operator-safe explanation. Never names a value, only a variable. */
  reason: string;
  missing: string[];
}

/**
 * Decides whether a live refresh may run at all. Every condition is a
 * precondition for a *correct* row, not merely a reachable API:
 *
 *   - `DASHBOARD_DATA_MODE=live` and `DASHBOARD_DATA_STORE=supabase`, because a
 *     live pull with nowhere durable to land is not a refresh.
 *   - `SUPABASE_SERVICE_ROLE_KEY`, because both the token read and the metric
 *     write are service-role only.
 *   - The Google application credential quartet. The refresh token is
 *     deliberately absent from this list: it is resolved per client from
 *     `connector_tokens`, so requiring it in the environment would keep the
 *     OAuth path permanently locked.
 *   - Both conversion action IDs. Without them the connector reports zero
 *     registrations and zero purchases by design, and a dashboard showing a
 *     real spend against zero conversions is worse than one that refuses to
 *     refresh.
 *
 * Meta is not required: the pilot may run Google-only, and the sync route
 * fails that platform closed rather than substituting synthetic rows.
 */
export function resolveLiveSyncGate(
  environment: Record<string, string | undefined> = process.env,
): LiveSyncGate {
  const mode = environment.DASHBOARD_DATA_MODE === "live" ? "live" : "mock";
  const storage =
    environment.DASHBOARD_DATA_STORE === "supabase" ? "supabase" : "fixture";

  if (mode !== "live") {
    return {
      unlocked: false,
      reason:
        "Live sync stays locked while DASHBOARD_DATA_MODE is not set to live.",
      missing: ["DASHBOARD_DATA_MODE"],
    };
  }

  if (storage !== "supabase") {
    return {
      unlocked: false,
      reason:
        "Live sync needs DASHBOARD_DATA_STORE=supabase so pulled rows have a durable home.",
      missing: ["DASHBOARD_DATA_STORE"],
    };
  }

  const required = [
    "SUPABASE_SERVICE_ROLE_KEY",
    "GOOGLE_ADS_DEVELOPER_TOKEN",
    "GOOGLE_ADS_CLIENT_ID",
    "GOOGLE_ADS_CLIENT_SECRET",
    "GOOGLE_ADS_CUSTOMER_ID",
    "GOOGLE_ADS_REGISTRATION_CONVERSION_ACTION_ID",
    "GOOGLE_ADS_PURCHASE_CONVERSION_ACTION_ID",
  ];

  const missing = required.filter((key) => !environment[key]?.trim());

  if (missing.length > 0) {
    return {
      unlocked: false,
      reason: `Live sync is missing ${missing.length} required server-side setting(s): ${missing.join(", ")}.`,
      missing,
    };
  }

  return {
    unlocked: true,
    reason:
      "Credential, mapping, and storage gates are satisfied. Live sync may run.",
    missing: [],
  };
}

/**
 * Re-exported so existing callers keep working. The implementation lives in a
 * credential-free module because the connector panel is a client component and
 * importing a value from this file pulls the provider catalog — and its
 * `process.env` secret reads — into the browser bundle.
 */
export {
  groupMissingSettings,
  type MissingSettingGroup,
} from "@/lib/connectors/missing-settings";

export interface ConnectorHealthReport {
  mode: DashboardDataMode;
  storage: DashboardStorageMode;
  readOnlyEnforced: true;
  liveSyncLocked: boolean;
  /** Why live sync is locked, or the confirmation that it is not. */
  liveSyncGateReason: string;
  /** Variable names the gate still needs. Empty when live sync may run. */
  liveSyncMissing: string[];
  checkedAt: string;
  platforms: ConnectorPlatformStatus[];
  openDecisions: string[];
}

export interface ConnectorHealthInput {
  mode: DashboardDataMode;
  storage: DashboardStorageMode;
  /** Injected for tests so the report never depends on ambient process state. */
  environment?: Record<string, string | undefined>;
  now?: Date;
}

const OPEN_DECISIONS = [
  "Confirm the official registration and purchase event per platform.",
  "Confirm whether the $30 target applies to purchase, registration, or blended acquisition.",
  "Confirm the account timezone and attribution setting that become the reporting contract.",
  "Choose the production credential path: official API or a remote MCP with server-side authentication.",
] as const;

function resolveCredentialStatus(
  environmentVariable: string | undefined,
  environment: Record<string, string | undefined>,
): ConnectorCredentialStatus {
  if (!environmentVariable) return "not-selected";
  return environment[environmentVariable]?.trim()
    ? "configured"
    : "missing";
}

function credentialMessage(status: ConnectorCredentialStatus): string {
  if (status === "configured") {
    return "A server-side credential is present. Values are never returned by this endpoint.";
  }
  if (status === "missing") {
    return "The declared credential variable is empty on this environment.";
  }
  return "No credential path is selected yet, so this provider cannot be activated.";
}

/**
 * Reports connector readiness without secrets and without any network call.
 * The catalog is static metadata and the mock connector answers locally, so
 * this route cannot reach Google Ads, Meta Ads, or GA4.
 */
export async function buildConnectorHealthReport(
  input: ConnectorHealthInput,
): Promise<ConnectorHealthReport> {
  const environment = input.environment ?? {};
  const checkedAt = (input.now ?? new Date()).toISOString();
  const platforms: ConnectorPlatformStatus[] = [];

  for (const platform of ["meta", "google"] as const) {
    const mockHealth = await new MockAdsConnector(platform).health();
    const providers: ConnectorProviderStatus[] = [
      {
        providerId: mockHealth.providerId,
        providerKind: mockHealth.providerKind,
        priority: 0,
        readOnly: true,
        credentialStatus: "not-selected",
        activation: input.mode === "mock" ? "active" : "locked",
        safeMessage: mockHealth.safeMessage,
      },
    ];

    for (const provider of getProviderPriority(platform)) {
      const credentialStatus = resolveCredentialStatus(
        provider.credentialEnvironmentVariable,
        environment,
      );

      providers.push({
        providerId: provider.providerId,
        providerKind: provider.providerKind,
        priority: provider.priority,
        readOnly: true,
        credentialStatus,
        activation: "locked",
        ...(provider.endpoint ? { endpoint: provider.endpoint } : {}),
        ...(provider.repository ? { repository: provider.repository } : {}),
        safeMessage: credentialMessage(credentialStatus),
      });
    }

    const activeProvider = providers.find(
      (provider) => provider.activation === "active",
    );

    platforms.push({
      platform,
      activeProviderId: activeProvider?.providerId ?? null,
      status: activeProvider
        ? "mock-ready"
        : input.mode === "mock"
          ? "locked"
          : "unavailable",
      safeMessage: activeProvider
        ? `Synthetic ${platform} data is served locally. No advertising API is called.`
        : `No ${platform} provider is activated. Live sync stays fail-closed.`,
      providers,
    });
  }

  // The sync route and this report read the same gate, so the badge can never
  // claim a lock the route does not actually enforce.
  const gate = resolveLiveSyncGate(environment);

  return {
    mode: input.mode,
    storage: input.storage,
    readOnlyEnforced: true,
    liveSyncLocked: !gate.unlocked,
    liveSyncGateReason: gate.reason,
    liveSyncMissing: [...gate.missing],
    checkedAt,
    platforms,
    openDecisions: [...OPEN_DECISIONS],
  };
}
