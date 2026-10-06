import type { Platform } from "@/lib/dashboard/types";
import {
  ConnectorFailure,
  type ConnectorAttempt,
  type ConnectorHealth,
  type ConnectorRequest,
  type ConnectorResult,
  type ReadOnlyAdsConnector,
} from "@/lib/connectors/types";

const retryableHealthCodes = {
  unavailable: "unavailable",
  unauthenticated: "unauthenticated",
} as const;

export class FallbackConnectorGateway implements ReadOnlyAdsConnector {
  readonly providerId: string;
  readonly providerKind = "gateway" as const;
  readonly mode: "mock" | "live";

  constructor(
    readonly platform: Exclude<Platform, "all">,
    private readonly providers: readonly ReadOnlyAdsConnector[],
  ) {
    if (providers.length === 0) {
      throw new Error("A connector gateway requires at least one provider.");
    }

    if (providers.some((provider) => provider.platform !== platform)) {
      throw new Error("All gateway providers must target the same platform.");
    }

    const duplicateProvider = providers.find(
      (provider, index) =>
        providers.findIndex(
          (candidate) => candidate.providerId === provider.providerId,
        ) !== index,
    );

    if (duplicateProvider) {
      throw new Error(
        `Duplicate connector provider: ${duplicateProvider.providerId}.`,
      );
    }

    this.providerId = `${platform}-fallback-gateway`;
    this.mode = providers.every((provider) => provider.mode === "mock")
      ? "mock"
      : "live";
  }

  async health(): Promise<ConnectorHealth> {
    const checks = await Promise.allSettled(
      this.providers.map((provider) => provider.health()),
    );
    const usable = checks.find(
      (check): check is PromiseFulfilledResult<ConnectorHealth> =>
        check.status === "fulfilled" &&
        check.value.available &&
        check.value.authenticated &&
        check.value.readOnly,
    );

    return {
      providerId: this.providerId,
      providerKind: this.providerKind,
      available: checks.some(
        (check) => check.status === "fulfilled" && check.value.available,
      ),
      authenticated: Boolean(usable),
      readOnly: true,
      safeMessage: usable
        ? `Read-only provider ${usable.value.providerId} is ready.`
        : "No authenticated read-only provider is ready.",
    };
  }

  async fetchDailyMetrics(
    request: ConnectorRequest,
  ): Promise<ConnectorResult> {
    const attempts: ConnectorAttempt[] = [];

    for (const provider of this.providers) {
      let health: ConnectorHealth;

      try {
        health = await provider.health();
      } catch {
        attempts.push({
          providerId: provider.providerId,
          outcome: "skipped",
          failureCode: retryableHealthCodes.unavailable,
          safeMessage: "Provider health check failed.",
        });
        continue;
      }

      if (!health.readOnly) {
        throw new ConnectorFailure(
          "configuration-error",
          `Provider ${provider.providerId} is not read-only.`,
          false,
        );
      }

      if (!health.available || !health.authenticated) {
        attempts.push({
          providerId: provider.providerId,
          outcome: "skipped",
          failureCode: health.available
            ? retryableHealthCodes.unauthenticated
            : retryableHealthCodes.unavailable,
          safeMessage: health.safeMessage,
        });
        continue;
      }

      try {
        const result = await provider.fetchDailyMetrics(request);

        return {
          ...result,
          providerId: provider.providerId,
          attempts: [
            ...attempts,
            {
              providerId: provider.providerId,
              outcome: "succeeded",
              safeMessage: "Provider returned metrics.",
            },
          ],
        };
      } catch (error) {
        if (!(error instanceof ConnectorFailure)) {
          throw error;
        }

        attempts.push({
          providerId: provider.providerId,
          outcome: "failed",
          failureCode: error.code,
          safeMessage: error.message,
        });

        if (!error.retryable) {
          throw error;
        }
      }
    }

    throw new ConnectorFailure(
      "unavailable",
      `No ${this.platform} connector completed the request. Attempts: ${attempts
        .map((attempt) => `${attempt.providerId}:${attempt.failureCode}`)
        .join(", ")}.`,
      true,
    );
  }
}
