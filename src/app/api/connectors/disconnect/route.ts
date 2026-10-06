import { NextRequest } from "next/server";

import { hasPermission } from "@/lib/auth/authorization";
import { resolveClientScope } from "@/lib/auth/client-scope";
import {
  authFailureResponse,
  isSameOriginRequest,
  privateJson,
} from "@/lib/auth/http";
import { resolveAuthContext } from "@/lib/auth/session";
import { recordAuditEvent } from "@/lib/audit/activity-log";
import { revokeConnectorToken } from "@/lib/connectors/token-storage";

export const runtime = "nodejs";

interface DisconnectRequest {
  platform?: unknown;
  client?: unknown;
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return privateJson({ error: "Request origin is not allowed." }, { status: 403 });
  }

  let body: DisconnectRequest;
  try {
    body = (await request.json()) as DisconnectRequest;
  } catch {
    return privateJson({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  // Revoking is destructive, so the brand is read before the session is
  // resolved: authorisation is checked against the brand actually being
  // disconnected, not against the pilot.
  const scope = resolveClientScope(body.client);
  if (!scope.ok) {
    return privateJson({ error: scope.message }, { status: 400 });
  }

  const auth = await resolveAuthContext(scope.clientSlug);
  if (!auth.ok) return authFailureResponse(auth);
  if (!hasPermission(auth.context.access.role, "sync:trigger")) {
    return privateJson(
      { error: "Your role cannot disconnect data sources." },
      { status: 403 },
    );
  }

  const platform = typeof body.platform === "string" ? body.platform : "";
  if (!platform) {
    return privateJson({ error: "Platform identifier is required." }, { status: 400 });
  }

  // Clearing the status cookie only changes what the UI draws. The stored
  // credential is what actually grants access, so it is revoked first and the
  // route reports failure if that write does not land — otherwise "disconnected"
  // would be a cosmetic claim over a still-usable refresh token.
  let revoked = false;
  try {
    revoked = await revokeConnectorToken(platform, scope.clientSlug);
  } catch {
    return privateJson(
      {
        error:
          "The stored credential could not be revoked, so this connector is still connected. Try again before treating it as disconnected.",
      },
      { status: 503 },
    );
  }

  // Revoking a credential is as much a governance event as granting one.
  await recordAuditEvent({
    clientId: auth.context.access.clientId,
    actorUserId: auth.context.userId,
    actorEmail: auth.context.email,
    actorRole: auth.context.access.role,
    action: "connector.disconnected",
    subject: platform,
    detail: { credentialRevoked: revoked, clientSlug: scope.clientSlug },
  });

  const response = privateJson({
    ok: true,
    platform,
    revoked,
    message: revoked
      ? `${platform} disconnected and the stored credential was revoked.`
      : `${platform} disconnected. No stored credential was found for this client.`,
  });

  response.cookies.delete(`connector_${platform}_status`);

  return response;
}
