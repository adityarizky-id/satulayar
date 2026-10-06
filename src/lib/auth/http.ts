import { NextRequest, NextResponse } from "next/server";

import type { AuthFailure } from "@/lib/auth/types";

export function authFailureResponse(failure: AuthFailure) {
  return NextResponse.json(
    { error: failure.safeMessage, code: failure.code },
    {
      status: failure.status,
      headers: {
        "Cache-Control": "no-store, private",
        "Vary": "Cookie",
      },
    },
  );
}

export function privateJson<T>(
  body: T,
  init?: { status?: number },
) {
  return NextResponse.json(body, {
    status: init?.status,
    headers: {
      "Cache-Control": "no-store, private",
      "Vary": "Cookie",
    },
  });
}

function normalizeOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function isAllowedOrigin(
  origin: string | null,
  allowedOrigins: readonly string[],
): boolean {
  const normalizedOrigin = origin ? normalizeOrigin(origin) : null;
  if (!normalizedOrigin) return false;

  return allowedOrigins.some(
    (candidate) => normalizeOrigin(candidate) === normalizedOrigin,
  );
}

export function isSameOriginRequest(request: NextRequest): boolean {
  const allowedOrigins = [request.nextUrl.origin];
  const forwardedHost = request.headers.get("x-forwarded-host");
  const requestHost = forwardedHost ?? request.headers.get("host");
  const forwardedProtocol = request.headers.get("x-forwarded-proto");
  const requestProtocol =
    forwardedProtocol ?? request.nextUrl.protocol.replace(":", "");

  if (requestHost) {
    allowedOrigins.push(`${requestProtocol}://${requestHost}`);
  }

  const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configuredSiteUrl) allowedOrigins.push(configuredSiteUrl);

  return isAllowedOrigin(request.headers.get("origin"), allowedOrigins);
}

export function safeInternalPath(
  value: string | null,
  fallback = "/",
): string {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\")
  ) {
    return fallback;
  }

  return value;
}
