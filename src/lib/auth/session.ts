import { getAuthConfiguration } from "@/lib/auth/auth-config";
import type {
  AppRole,
  AuthResolution,
  ClientAccess,
} from "@/lib/auth/types";
import { APP_ROLES } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";

interface MembershipRow {
  client_id: string;
  client:
    | {
        display_name: string;
        slug: string;
      }
    | {
        display_name: string;
        slug: string;
      }[];
  role: AppRole;
}

function resolveClient(row: MembershipRow): {
  display_name: string;
  slug: string;
} | null {
  if (Array.isArray(row.client)) return row.client[0] ?? null;
  return row.client ?? null;
}

export function resolvePreviewRole(
  value = process.env.DASHBOARD_PREVIEW_ROLE,
): AppRole {
  return APP_ROLES.includes(value as AppRole)
    ? (value as AppRole)
    : "internal_editor";
}

export async function resolveAuthContext(
  clientSlug: string,
): Promise<AuthResolution> {
  const configuration = getAuthConfiguration();

  if (!configuration.ready) {
    return {
      ok: false,
      code: "auth_unavailable",
      status: 503,
      safeMessage: configuration.safeMessage,
    };
  }

  if (configuration.mode === "preview") {
    return {
      ok: true,
      context: {
        userId: "preview-internal-editor",
        email: "local-preview@invalid.example",
        mode: "preview",
        access: {
          clientId: "preview-kopi-senja",
          clientSlug,
          clientName: "Kopi Senja Nusantara",
          role: resolvePreviewRole(),
        },
      },
    };
  }

  const supabase = await createClient();
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  const userId = typeof claims?.sub === "string" ? claims.sub : null;

  if (claimsError || !userId) {
    return {
      ok: false,
      code: "unauthenticated",
      status: 401,
      safeMessage: "Sign in is required to view this dashboard.",
    };
  }

  const { data, error } = await supabase
    .from("client_memberships")
    .select(
      "client_id, role, client:clients!inner(slug, display_name)",
    )
    .eq("user_id", userId)
    .eq("is_active", true)
    .eq("clients.slug", clientSlug)
    .limit(1);

  if (error) {
    return {
      ok: false,
      code: "auth_unavailable",
      status: 503,
      safeMessage:
        "Access membership could not be verified. Try again later.",
    };
  }

  const membership = (data?.[0] ?? null) as MembershipRow | null;
  const client = membership ? resolveClient(membership) : null;

  let email =
    typeof claims?.email === "string" ? claims.email : null;

  if (!email && userId) {
    try {
      const { data: userData } = await supabase.auth.getUser();
      email = userData?.user?.email ?? null;
    } catch {
      // Ignore fallback fetch error
    }
  }

  if (!membership || !client) {
    return {
      ok: false,
      code: "client_access_denied",
      status: 403,
      safeMessage:
        "Your account does not have access to this client dashboard.",
    };
  }

  const access: ClientAccess = {
    clientId: membership.client_id,
    clientSlug: client.slug,
    clientName: client.display_name,
    role: membership.role,
  };

  return {
    ok: true,
    context: {
      userId,
      email,
      mode: "supabase",
      access,
    },
  };
}
