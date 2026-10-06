import { ConnectorFailure } from "@/lib/connectors/types";

export const GOOGLE_OAUTH_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export interface GoogleRefreshTokenExchange {
  clientId?: string;
  clientSecret?: string;
  refreshToken: string;
}

/**
 * Exchanges a stored refresh token for a short-lived Google access token.
 *
 * Shared by every Google-family connector, so the failure classification is
 * decided once. The distinction matters operationally: a throttled or briefly
 * unavailable token endpoint is retryable and must not be reported as a dead
 * credential, because that tells the operator to re-authorise an account that
 * is working perfectly well.
 *
 * Deliberately not cached. These connectors run a handful of times per sync,
 * and correctness is worth more than saving one token request on a bounded,
 * low-frequency job.
 */
export async function exchangeGoogleRefreshToken(
  input: GoogleRefreshTokenExchange,
): Promise<string> {
  let response: Response;
  try {
    response = await fetch(GOOGLE_OAUTH_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: input.clientId ?? "",
        client_secret: input.clientSecret ?? "",
        refresh_token: input.refreshToken,
        grant_type: "refresh_token",
      }),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Network error";
    throw new ConnectorFailure(
      "unavailable",
      `Google OAuth token endpoint unreachable: ${message}`,
      true,
    );
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    if (response.status === 429) {
      throw new ConnectorFailure(
        "rate-limited",
        `Google OAuth token endpoint throttled the request (429): ${detail.slice(0, 200)}`,
        true,
      );
    }
    if (response.status >= 500) {
      throw new ConnectorFailure(
        "unavailable",
        `Google OAuth token endpoint server error (${response.status}): ${detail.slice(0, 200)}`,
        true,
      );
    }
    throw new ConnectorFailure(
      "unauthenticated",
      `Google OAuth token refresh failed (${response.status}): ${detail.slice(0, 200)}`,
      false,
    );
  }

  const body = (await response.json()) as { access_token?: string };
  if (!body.access_token) {
    throw new ConnectorFailure(
      "unauthenticated",
      "Google OAuth token refresh response did not include an access token.",
      false,
    );
  }

  return body.access_token;
}
