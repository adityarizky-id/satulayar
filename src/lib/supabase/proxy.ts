import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getAuthConfiguration } from "@/lib/auth/auth-config";

export async function updateSupabaseSession(request: NextRequest) {
  const configuration = getAuthConfiguration();

  if (
    configuration.mode !== "supabase" ||
    !configuration.ready ||
    !configuration.supabaseUrl ||
    !configuration.publishableKey
  ) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    configuration.supabaseUrl,
    configuration.publishableKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headersToSet) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
          Object.entries(headersToSet).forEach(([key, value]) => {
            response.headers.set(key, value);
          });
        },
      },
    },
  );

  // Keep this call adjacent to client creation so refreshed cookies stay in
  // sync. Protected pages and APIs still verify claims independently.
  await supabase.auth.getClaims();

  return response;
}
