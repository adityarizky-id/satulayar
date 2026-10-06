import { NextRequest, NextResponse } from "next/server";

import { getAuthConfiguration } from "@/lib/auth/auth-config";
import { isSameOriginRequest, privateJson } from "@/lib/auth/http";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return privateJson(
      { error: "Request origin is not allowed." },
      { status: 403 },
    );
  }

  const configuration = getAuthConfiguration();
  if (configuration.mode === "supabase" && configuration.ready) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }

  return NextResponse.redirect(new URL("/sign-in", request.url), {
    status: 303,
    headers: { "Cache-Control": "no-store, private" },
  });
}
