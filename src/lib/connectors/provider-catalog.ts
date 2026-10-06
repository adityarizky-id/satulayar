import type {
  ConnectorProviderKind,
} from "@/lib/connectors/types";
import type {
  MetricSourceConnector,
  Platform,
} from "@/lib/dashboard/types";

export interface ConnectorProviderDefinition {
  providerId: Exclude<MetricSourceConnector, "mock">;
  platform: Exclude<Platform, "all">;
  providerKind: Exclude<ConnectorProviderKind, "gateway" | "mock">;
  priority: number;
  readOnlyRequired: true;
  endpoint?: string;
  repository?: string;
  /**
   * Name of the server-side variable that would hold this provider's
   * credential. It stays undefined until the production credential path is
   * approved; the value itself is never read into a client response.
   */
  credentialEnvironmentVariable?: string;
}

export const connectorProviderCatalog = [
  {
    providerId: "meta-official-mcp",
    platform: "meta",
    providerKind: "official-mcp",
    priority: 10,
    readOnlyRequired: true,
    endpoint: "https://mcp.facebook.com/ads",
  },
  {
    providerId: "meta-community-mcp",
    platform: "meta",
    providerKind: "community-mcp",
    priority: 20,
    readOnlyRequired: true,
    repository: "https://github.com/hashcott/meta-ads-mcp-server",
  },
  {
    providerId: "meta-pipeboard",
    platform: "meta",
    providerKind: "managed-mcp",
    priority: 30,
    readOnlyRequired: true,
    endpoint: "https://meta-ads.mcp.pipeboard.co/",
    repository: "https://github.com/pipeboard-co/meta-ads-mcp",
  },
  {
    providerId: "google-official-mcp",
    platform: "google",
    providerKind: "official-mcp",
    priority: 10,
    readOnlyRequired: true,
    repository: "https://github.com/googleads/google-ads-mcp",
  },
  {
    providerId: "google-experimental-mcp",
    platform: "google",
    providerKind: "community-mcp",
    priority: 20,
    readOnlyRequired: true,
    repository:
      "https://github.com/google-marketing-solutions/google_ads_mcp",
  },
  {
    providerId: "google-pipeboard",
    platform: "google",
    providerKind: "managed-mcp",
    priority: 30,
    readOnlyRequired: true,
    endpoint: "https://google-ads.mcp.pipeboard.co/",
  },
] as const satisfies readonly ConnectorProviderDefinition[];

export function getProviderPriority(
  platform: Exclude<Platform, "all">,
): readonly ConnectorProviderDefinition[] {
  return connectorProviderCatalog
    .filter((provider) => provider.platform === platform)
    .toSorted((left, right) => left.priority - right.priority);
}
