import { NextRequest } from "next/server";

import { hasPermission } from "@/lib/auth/authorization";
import { resolveActiveClientSlug } from "@/lib/auth/client-scope";
import {
  authFailureResponse,
  isSameOriginRequest,
  privateJson,
} from "@/lib/auth/http";
import { resolveAuthContext } from "@/lib/auth/session";
import { GoogleAdsApiClient } from "@/lib/connectors/google-ads-api-client";
import { loadGoogleAdsConfig } from "@/lib/connectors/google-ads-config";
import { ACCOUNT_COOKIE } from "@/lib/dashboard/accounts";

export const runtime = "nodejs";

interface TestConnectionRequest {
  platform?: unknown;
  /** Brand slug. Absent means the brand selector cookie, then the pilot. */
  client?: unknown;
}

/**
 * Read-only credential verification, separate from the dashboard sync path.
 * It never writes a row, never changes DASHBOARD_DATA_MODE, and never lifts
 * the live-sync lock in sync-jobs/health.ts — those stay gated behind the
 * connector parity gate. This route only answers "does the stored
 * credential actually authenticate," which is the evidence that gate needs.
 */
export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return privateJson({ error: "Request origin is not allowed." }, { status: 403 });
  }

  let body: TestConnectionRequest;
  try {
    body = (await request.json()) as TestConnectionRequest;
  } catch {
    return privateJson({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  // The brand is resolved before the session so the role check below is the
  // role on THAT brand, not on the pilot.
  const scope = resolveActiveClientSlug({
    requested: body.client,
    cookie: request.cookies.get(ACCOUNT_COOKIE)?.value,
  });
  if (!scope.ok) return privateJson({ error: scope.message }, { status: 400 });

  const auth = await resolveAuthContext(scope.clientSlug);
  if (!auth.ok) return authFailureResponse(auth);
  if (!hasPermission(auth.context.access.role, "sync:trigger")) {
    return privateJson(
      { error: "Your role cannot test a data source connection." },
      { status: 403 },
    );
  }

  if (body.platform !== "google-ads") {
    return privateJson(
      {
        error:
          "Only the Google Ads connection test is implemented. Meta Ads and store connectors are not wired up yet.",
      },
      { status: 400 },
    );
  }

  // Test the selected brand's own account. The bare client reads the pilot's
  // unsuffixed settings, which would report "connected" for the wrong brand.
  const resolution = await loadGoogleAdsConfig(scope.clientSlug);
  if (!resolution.ok) {
    return privateJson(
      {
        ok: false,
        safeMessage: resolution.safeMessage,
        testedAt: new Date().toISOString(),
      },
      { status: 502 },
    );
  }

  const health = await new GoogleAdsApiClient(resolution.config).health();

  return privateJson(
    {
      ok: health.authenticated,
      safeMessage: health.safeMessage,
      testedAt: new Date().toISOString(),
    },
    { status: health.authenticated ? 200 : 502 },
  );
}
