import { NextRequest } from "next/server";

import { getAuthConfiguration } from "@/lib/auth/auth-config";
import { isAllowedLoginEmail } from "@/lib/auth/constants";
import { isSameOriginRequest, privateJson } from "@/lib/auth/http";
import { createClient } from "@/lib/supabase/server";

interface PasswordSignInRequest {
  email?: unknown;
  password?: unknown;
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

  let body: PasswordSignInRequest;
  try {
    body = (await request.json()) as PasswordSignInRequest;
  } catch {
    return privateJson(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  if (!isValidEmail(body.email)) {
    return privateJson(
      { error: "Enter a valid email address." },
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

  if (typeof body.password !== "string" || body.password.length < 6) {
    return privateJson(
      { error: "Enter a valid password (minimum 6 characters)." },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: normalizedEmail,
    password: body.password,
  });

  if (error) {
    return privateJson(
      { error: "Invalid email or password." },
      { status: 401 },
    );
  }

  return privateJson(
    { ok: true, message: "Authenticated successfully." },
    { status: 200 },
  );
}
