import { NextRequest } from "next/server";

import { hasPermission } from "@/lib/auth/authorization";
import { resolveActiveClientSlug } from "@/lib/auth/client-scope";
import { authFailureResponse, privateJson } from "@/lib/auth/http";
import { resolveAuthContext } from "@/lib/auth/session";
import { buildConnectorHealthReport } from "@/lib/connectors/health";
import { ACCOUNT_COOKIE } from "@/lib/dashboard/accounts";
import { getDashboardDataConfiguration } from "@/lib/dashboard/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const scope = resolveActiveClientSlug({
    requested: request.nextUrl.searchParams.get("account"),
    cookie: request.cookies.get(ACCOUNT_COOKIE)?.value,
  });
  if (!scope.ok) return privateJson({ error: scope.message }, { status: 400 });

  const auth = await resolveAuthContext(scope.clientSlug);
  if (!auth.ok) return authFailureResponse(auth);

  if (!hasPermission(auth.context.access.role, "sync:trigger")) {
    return privateJson(
      { error: "Your role cannot read connector health." },
      { status: 403 },
    );
  }

  const configuration = getDashboardDataConfiguration();
  const report = await buildConnectorHealthReport({
    mode: configuration.mode,
    storage: configuration.storage,
    environment: process.env,
  });

  return privateJson(report);
}
