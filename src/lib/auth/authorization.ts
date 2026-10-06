import type { AppRole, DashboardPermission } from "@/lib/auth/types";

const ROLE_PERMISSIONS: Record<AppRole, readonly DashboardPermission[]> = {
  admin: [
    "dashboard:read",
    "sync:trigger",
    "worklog:write",
    "summary:review",
    "audience:export",
    "budget:write",
    "access:manage",
  ],
  // The PPC operator is the person who actually uploads an audience, so the
  // export has to work for this role or the workflow moves back to spreadsheets.
  internal_editor: [
    "dashboard:read",
    "sync:trigger",
    "worklog:write",
    "summary:review",
    "audience:export",
    "budget:write",
  ],
  // A viewer reads performance. Customer identities are not performance.
  viewer: ["dashboard:read"],
};

export function hasPermission(
  role: AppRole,
  permission: DashboardPermission,
): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
