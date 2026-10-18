import { memo } from "react";

import type { DashboardViewer } from "@/lib/auth/types";
import { AccountIcon } from "@/components/dashboard/icons";

const ROLE_LABELS: Record<DashboardViewer["role"], string> = {
  admin: "Administrator",
  internal_editor: "Internal Editor",
  viewer: "Client Viewer",
};

export const SessionIdentityPanel = memo(function SessionIdentityPanel({
  authMode,
  viewer,
  workspaceName,
}: {
  authMode: "preview" | "supabase";
  viewer: DashboardViewer;
  workspaceName?: string;
}) {
  const isSupabase = authMode === "supabase";

  return (
    <section
      className="session-panel"
      id="session-identity"
      aria-labelledby="session-identity-title"
    >
      <header className="session-panel__header">
        <div>
          <h2 id="session-identity-title">Signed-in identity</h2>
        </div>
        <span className={`signal-chip signal-chip--${isSupabase ? "connected" : "planned"}`}>
          <span aria-hidden="true" className="signal-chip__dot" />
          {isSupabase ? "Signed in" : "Preview"}
        </span>
      </header>
      <div className="session-persona">
        <span aria-hidden="true" className="session-persona__icon"><AccountIcon /></span>
        <div>
          <strong>{ROLE_LABELS[viewer.role]}{isSupabase ? "" : " (local session)"}</strong>
          <span>{isSupabase ? "Authenticated workspace session" : "Preview identity · no live account session"}</span>
        </div>
      </div>
      <dl className="session-facts">
        <div>
          <dt>Workspace context</dt>
          <dd>{workspaceName ?? "Current workspace"}</dd>
        </div>
        <div>
          <dt>Role</dt>
          <dd>{ROLE_LABELS[viewer.role]}</dd>
        </div>
        <div className="session-facts__session">
          <dt>{isSupabase ? "Email" : "Session type"}</dt>
          <dd>{isSupabase ? viewer.email ?? "Signed in" : "Local preview"}</dd>
        </div>
      </dl>
      <p className="session-panel__note">{isSupabase ? "Access follows your current workspace role." : "This local preview does not establish a live account session."}</p>
    </section>
  );
});
