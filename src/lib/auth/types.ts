export const APP_ROLES = ["admin", "internal_editor", "viewer"] as const;

export type AppRole = (typeof APP_ROLES)[number];

export const DASHBOARD_PERMISSIONS = [
  "dashboard:read",
  "sync:trigger",
  "worklog:write",
  "summary:review",
  // Downloading a customer-match file means taking real names, emails, phone
  // numbers and postal codes out of the system. It gets its own permission
  // rather than riding on a reporting one, so the question "who may export
  // customer data?" has a single, auditable answer.
  "audience:export",
  // Recording the agreed monthly budget states what the team settled with
  // the client. It steers every pacing verdict on the dashboard, so it is an
  // editor action: a viewer reads the plan and cannot rewrite it.
  "budget:write",
  "access:manage",
] as const;

export type DashboardPermission = (typeof DASHBOARD_PERMISSIONS)[number];

export interface ClientAccess {
  clientId: string;
  clientSlug: string;
  clientName: string;
  role: AppRole;
}

export interface AuthContext {
  userId: string;
  email: string | null;
  mode: "preview" | "supabase";
  access: ClientAccess;
}

export type AuthFailureCode =
  | "auth_unavailable"
  | "unauthenticated"
  | "client_access_denied";

export interface AuthFailure {
  ok: false;
  code: AuthFailureCode;
  status: 401 | 403 | 503;
  safeMessage: string;
}

export interface AuthSuccess {
  ok: true;
  context: AuthContext;
}

export type AuthResolution = AuthFailure | AuthSuccess;

export interface DashboardViewer {
  email: string | null;
  mode: AuthContext["mode"];
  role: AppRole;
}
