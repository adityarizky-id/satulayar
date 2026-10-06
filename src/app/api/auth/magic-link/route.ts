import { NextRequest } from "next/server";

import { getAuthConfiguration } from "@/lib/auth/auth-config";
import { isAllowedLoginEmail } from "@/lib/auth/constants";
import { isSameOriginRequest, privateJson } from "@/lib/auth/http";
import { createClient } from "@/lib/supabase/server";

interface MagicLinkRequest {
  email?: unknown;
}

function isValidEmail(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  );
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return privateJson(
      { error: "Request origin is not allowed." },
      { status: 403 },
    );
  }

  const configuration = getAuthConfiguration();
  if (configuration.mode !== "supabase" || !configuration.ready) {
    return privateJson(
      { error: configuration.safeMessage },
      { status: 503 },
    );
  }

  let body: MagicLinkRequest;
  try {
    body = (await request.json()) as MagicLinkRequest;
  } catch {
    return privateJson(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  if (!isValidEmail(body.email)) {
    return privateJson(
      { error: "Enter a valid work email." },
      { status: 400 },
    );
  }

  const normalizedEmail = body.email.trim().toLowerCase();
  if (!isAllowedLoginEmail(normalizedEmail)) {
    return privateJson(
      { error: "Access is restricted to authorized team members." },
      { status: 403 },
    );
  }

  const redirectBase = configuration.siteUrl ?? request.nextUrl.origin;
  const callbackUrl = new URL("/auth/callback", redirectBase);
  callbackUrl.searchParams.set("next", "/");
  const supabase = await createClient();

  // Account creation is deliberately restricted to allowed emails.
  await supabase.auth.signInWithOtp({
    email: normalizedEmail,
    options: {
      emailRedirectTo: callbackUrl.toString(),
      shouldCreateUser: false,
    },
  });

  // Return one generic response so account existence is not disclosed.
  return privateJson(
    {
      message:
        "If that invited account exists, a secure sign-in link has been sent.",
    },
    { status: 202 },
  );
}
