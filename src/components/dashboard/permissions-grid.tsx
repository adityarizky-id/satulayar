import { memo } from "react";

import { hasPermission } from "@/lib/auth/authorization";
import {
  DASHBOARD_PERMISSIONS,
  type AppRole,
  type DashboardPermission,
} from "@/lib/auth/types";

const ROLE_LABELS: Record<AppRole, string> = {
  admin: "Administrator",
  internal_editor: "Editor",
  viewer: "Viewer",
};

const PERMISSION_LABELS: Record<
  DashboardPermission,
  string
> = {
  "dashboard:read": "View dashboards",
  "sync:trigger": "Run connector sync",
  "worklog:write": "Edit worklogs",
  "summary:review": "Review summaries",
  "audience:export": "Export customer audiences",
  "budget:write": "Set agreed budgets",
  "access:manage": "Manage access",
};

export const PermissionsGrid = memo(function PermissionsGrid({
  activeRole,
}: {
  activeRole: AppRole;
}) {
  const grantedPermissions = DASHBOARD_PERMISSIONS.filter((permission) =>
    hasPermission(activeRole, permission),
  );

  return (
    <section
      className="permissions-console"
      id="permissions-grid"
      aria-labelledby="permissions-title"
    >
      <details className="permissions-disclosure" open>
        <summary>
          <span className="permissions-disclosure__identity">
            <strong id="permissions-title">Access permissions</strong>
            <small>{ROLE_LABELS[activeRole]} role</small>
          </span>
          <span className="permissions-disclosure__count">
            {grantedPermissions.length} of {DASHBOARD_PERMISSIONS.length} enabled
          </span>
        </summary>
        <ul className="permissions-list">
          {DASHBOARD_PERMISSIONS.map((permission) => (
            <li key={permission}>
              <span aria-hidden="true" className={`permission-check${hasPermission(activeRole, permission) ? "" : " permission-check--restricted"}`}>
                {hasPermission(activeRole, permission) ? "✓" : "−"}
              </span>
              <span>{PERMISSION_LABELS[permission]}</span>
              {!hasPermission(activeRole, permission) && <span className="permission-restriction">Not included in this role</span>}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
});
