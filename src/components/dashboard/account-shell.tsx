"use client";

import { useCallback, useState } from "react";

import { AppFrame } from "@/components/dashboard/app-frame";
import { AuditLogPanel } from "@/components/dashboard/audit-log-panel";
import { rememberAccount } from "@/components/dashboard/filter-fields";
import { PermissionsGrid } from "@/components/dashboard/permissions-grid";
import { SessionIdentityPanel } from "@/components/dashboard/session-identity-panel";
import { WorkspaceSwitcher } from "@/components/dashboard/workspace-switcher";
import {
  getPreviewAuditEvents,
  type AuditEventRecord,
} from "@/lib/audit/types";
import type { DashboardViewer } from "@/lib/auth/types";
import type { AccountOption } from "@/lib/dashboard/accounts";

export function AccountShell({
  accounts,
  selectedAccount: initialSelectedAccount,
  authMode,
  viewer,
  auditEvents,
}: {
  accounts: AccountOption[];
  selectedAccount: string;
  authMode: "preview" | "supabase";
  viewer: DashboardViewer;
  auditEvents?: AuditEventRecord[];
}) {
  const [activeAccount, setActiveAccount] = useState(initialSelectedAccount);
  const [workspaceAnnouncement, setWorkspaceAnnouncement] = useState("");

  const activeWorkspace =
    accounts.find((account) => account.slug === activeAccount) ?? accounts[0];

  const handleSwitchAccount = useCallback(
    (slug: string) => {
      const nextWorkspace = accounts.find((account) => account.slug === slug);
      rememberAccount(slug);
      setActiveAccount(slug);
      setWorkspaceAnnouncement(
        `Current workspace changed to ${nextWorkspace?.name ?? "the selected brand"}.`,
      );
    },
    [accounts],
  );

  // Sample events exist only for the local preview. A signed-in session shows
  // what the server recorded, and an empty trail stays empty rather than
  // borrowing examples that would read as real activity.
  const isSampleAudit = authMode === "preview";
  const resolvedAuditEvents = isSampleAudit
    ? getPreviewAuditEvents(activeAccount)
    : (auditEvents ?? []);

  return (
    <AppFrame
      activeHref="/account"
      gateLabel={authMode === "supabase" ? "Supabase session" : "Local preview"}
      gateNote=""
      topbar={
        <div className="topbar__context">
          <span className="status-dot" />
          <span>Account</span>
          <strong>{activeWorkspace?.name ?? "Workspace"}</strong>
        </div>
      }
      viewer={viewer}
    >
      <header className="account-page-header">
        <div>
          <h1>Account &amp; access</h1>
          <p>
            Choose the brand you are working in, confirm what your role can do, and
            review protected account activity.
          </p>
        </div>
        <nav aria-label="Account sections" className="account-page-nav">
          <a href="#session-identity">Identity</a>
          <a href="#workspace-switcher">Workspaces</a>
          <a href="#permissions-grid">Permissions</a>
          <a href="#activity-audit-log">Activity</a>
        </nav>
      </header>

      <div className="account-console-layout">
        <div className="account-access-overview">
          <SessionIdentityPanel authMode={authMode} viewer={viewer} />
          <PermissionsGrid activeRole={viewer.role} />
        </div>
        <WorkspaceSwitcher
          accounts={accounts}
          activeAccount={activeAccount}
          onSwitch={handleSwitchAccount}
        />
        <AuditLogPanel
          entries={resolvedAuditEvents}
          isSample={isSampleAudit}
          viewer={viewer}
        />
        <p
          aria-atomic="true"
          aria-live="polite"
          className="visually-hidden"
          role="status"
        >
          {workspaceAnnouncement}
        </p>
      </div>
    </AppFrame>
  );
}
