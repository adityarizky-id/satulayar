import { memo } from "react";

import type { DashboardViewer } from "@/lib/auth/types";

const ROLE_LABELS: Record<DashboardViewer["role"], string> = {
  admin: "Administrator",
  internal_editor: "Internal Editor",
  viewer: "Client Viewer",
};

export const SessionIdentityPanel = memo(function SessionIdentityPanel({
  authMode,
  viewer,
}: {
  authMode: "preview" | "supabase";
  viewer: DashboardViewer;
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
          <p>
            {isSupabase
              ? "Verified through the active workspace session."
              : "Local preview session with no live credentials exposed."}
          </p>
        </div>
        <span className={`signal-chip signal-chip--${isSupabase ? "connected" : "planned"}`}>
          <span aria-hidden="true" className="signal-chip__dot" />
          {isSupabase ? "Signed in" : "Preview"}
        </span>
      </header>
      <dl className="session-facts">
        <div>
          <dt>Email</dt>
          <dd>{viewer.email ?? "Local preview user"}</dd>
        </div>
        <div>
          <dt>Role</dt>
          <dd>{ROLE_LABELS[viewer.role]}</dd>
        </div>
      </dl>
    </section>
  );
});
