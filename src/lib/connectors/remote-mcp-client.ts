import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { ConnectorFailure } from "@/lib/connectors/types";

export interface RemoteMcpClientConfiguration {
  providerId: string;
  endpoint: string;
  allowedTools: readonly string[];
  bearerTokenEnvironmentVariable?: string;
  timeoutMilliseconds?: number;
}

export interface RemoteMcpInspection {
  providerId: string;
  available: boolean;
  authenticated: boolean;
  discoveredAllowedTools: string[];
  missingAllowedTools: string[];
  safeMessage: string;
}

function isLocalHttpEndpoint(url: URL) {
  return (
    url.protocol === "http:" &&
    (url.hostname === "127.0.0.1" ||
      url.hostname === "localhost" ||
      url.hostname === "::1")
  );
}

function validateConfiguration(configuration: RemoteMcpClientConfiguration) {
  const endpoint = new URL(configuration.endpoint);

  if (endpoint.protocol !== "https:" && !isLocalHttpEndpoint(endpoint)) {
    throw new ConnectorFailure(
      "configuration-error",
      "Remote MCP endpoints must use HTTPS; HTTP is allowed only for localhost.",
      false,
    );
  }

  if (configuration.allowedTools.length === 0) {
    throw new ConnectorFailure(
      "configuration-error",
      "Remote MCP clients require an explicit tool allowlist.",
      false,
    );
  }

  if (new Set(configuration.allowedTools).size !== configuration.allowedTools.length) {
    throw new ConnectorFailure(
      "configuration-error",
      "Remote MCP tool allowlists cannot contain duplicates.",
      false,
    );
  }

  return endpoint;
}

function classifyRemoteError(error: unknown): ConnectorFailure {
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error);

  if (message.includes("quota") || message.includes("weekly_limit_exceeded")) {
    return new ConnectorFailure(
      "quota-exceeded",
      "Remote MCP provider quota is exhausted.",
      true,
    );
  }

  if (
    message.includes("429") ||
    message.includes("rate limit") ||
    message.includes("too many requests")
  ) {
    return new ConnectorFailure(
      "rate-limited",
      "Remote MCP provider rate limit was reached.",
      true,
    );
  }

  if (
    message.includes("401") ||
    message.includes("403") ||
    message.includes("unauthorized") ||
    message.includes("authentication")
  ) {
    return new ConnectorFailure(
      "unauthenticated",
      "Remote MCP authentication is unavailable or expired.",
      true,
    );
  }

  if (
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("abort")
  ) {
    return new ConnectorFailure(
      "timeout",
      "Remote MCP request timed out.",
      true,
    );
  }

  return new ConnectorFailure(
    "unavailable",
    "Remote MCP provider is unavailable.",
    true,
  );
}

export class RemoteMcpToolClient {
  private readonly endpoint: URL;
  private readonly allowedTools: ReadonlySet<string>;
  private readonly timeoutMilliseconds: number;

  constructor(private readonly configuration: RemoteMcpClientConfiguration) {
    this.endpoint = validateConfiguration(configuration);
    this.allowedTools = new Set(configuration.allowedTools);
    this.timeoutMilliseconds = configuration.timeoutMilliseconds ?? 30_000;
  }

  isToolAllowed(toolName: string) {
    return this.allowedTools.has(toolName);
  }

  private createTransport() {
    const tokenEnvironmentVariable =
      this.configuration.bearerTokenEnvironmentVariable;
    const token = tokenEnvironmentVariable
      ? process.env[tokenEnvironmentVariable]
      : undefined;

    return new StreamableHTTPClientTransport(this.endpoint, {
      requestInit: token
        ? {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        : undefined,
      reconnectionOptions: {
        maxReconnectionDelay: 5_000,
        initialReconnectionDelay: 500,
        reconnectionDelayGrowFactor: 2,
        maxRetries: 1,
      },
    });
  }

  private async connect() {
    const client = new Client({
      name: "satulayar-ads-connector-gateway",
      version: "0.1.0",
    });
    const transport = this.createTransport();

    await client.connect(transport, {
      timeout: this.timeoutMilliseconds,
    });

    return client;
  }

  async inspect(): Promise<RemoteMcpInspection> {
    let client: Client | undefined;

    try {
      client = await this.connect();
      const response = await client.listTools(
        {},
        { timeout: this.timeoutMilliseconds },
      );
      const availableTools = new Set(response.tools.map((tool) => tool.name));
      const discoveredAllowedTools = [...this.allowedTools].filter((tool) =>
        availableTools.has(tool),
      );
      const missingAllowedTools = [...this.allowedTools].filter(
        (tool) => !availableTools.has(tool),
      );

      return {
        providerId: this.configuration.providerId,
        available: true,
        authenticated: true,
        discoveredAllowedTools,
        missingAllowedTools,
        safeMessage:
          missingAllowedTools.length === 0
            ? "Remote MCP is ready with the required read-only tools."
            : "Remote MCP connected, but required read-only tools are missing.",
      };
    } catch (error) {
      throw classifyRemoteError(error);
    } finally {
      await client?.close().catch(() => undefined);
    }
  }

  async callAllowedTool(
    toolName: string,
    argumentsValue: Record<string, unknown>,
  ) {
    if (!this.isToolAllowed(toolName)) {
      throw new ConnectorFailure(
        "configuration-error",
        `MCP tool ${toolName} is not in the read-only allowlist.`,
        false,
      );
    }

    let client: Client | undefined;

    try {
      client = await this.connect();

      return await client.callTool(
        {
          name: toolName,
          arguments: argumentsValue,
        },
        undefined,
        { timeout: this.timeoutMilliseconds },
      );
    } catch (error) {
      if (error instanceof ConnectorFailure) throw error;
      throw classifyRemoteError(error);
    } finally {
      await client?.close().catch(() => undefined);
    }
  }
}
