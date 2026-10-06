import { NextRequest, NextResponse } from "next/server";

import { getAuthConfiguration } from "@/lib/auth/auth-config";
import { safeInternalPath } from "@/lib/auth/http";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const nextPath = safeInternalPath(
    request.nextUrl.searchParams.get("next"),
  );
  const configuration = getAuthConfiguration();

  if (
    code &&
    configuration.mode === "supabase" &&
    configuration.ready
  ) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return NextResponse.redirect(new URL(nextPath, request.url));
    }
  }

  const signInUrl = new URL("/sign-in", request.url);
  signInUrl.searchParams.set("reason", "callback_failed");
  return NextResponse.redirect(signInUrl);
}
