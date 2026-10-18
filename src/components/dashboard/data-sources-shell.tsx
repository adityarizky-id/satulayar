"use client";

import { Suspense, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

import { AppFrame } from "@/components/dashboard/app-frame";
import { AccountSyncTime } from "@/components/dashboard/clocks";
import {
  ConnectorConsole,
  type ConnectionTestState,
  type ConnectorRecovery,
  type DataSourceCard,
} from "@/components/dashboard/connector-console";
import {
  ConnectorCredentialsModal,
  type SavedCredentialsResult,
} from "@/components/dashboard/connector-credentials-modal";
import { ConnectorRuntimePanel } from "@/components/dashboard/connector-runtime-panel";
import { hasPermission } from "@/lib/auth/authorization";
import type { DashboardViewer } from "@/lib/auth/types";
import type { ConnectorHealthReport } from "@/lib/connectors/health";
import type { DirectConnectorPlatform } from "@/lib/connectors/types";

export type { DataSourceCard } from "@/components/dashboard/connector-console";

interface ConsoleNotice {
  type: "success" | "warning" | "error";
  title: string;
  message: string;
}

const OAUTH_PLATFORMS: Record<string, { name: string }> = {
  "google-ads": { name: "Google Ads" }, "meta-ads": { name: "Meta Ads" },
  "google-analytics": { name: "Google Analytics 4" },
};

interface SearchParamReader {
  get(name: string): string | null;
}

/**
 * What the operator should do next, which is the only thing that separates
 * these codes on screen. Re-authorizing fixes a rejected exchange; it does
 * nothing for a misconfigured deployment, and advising it there sends people
 * round a loop that cannot succeed.
 */
type OAuthFailureKind =
  | "cancelled"
  | "session"
  | "configuration"
  | "refresh-token"
  | "permission"
  | "exchange"
  | "unknown";

const OAUTH_FAILURE_KINDS: Record<string, OAuthFailureKind> = {
  consent_denied: "cancelled",
  invalid_state: "session",
  missing_code_or_state: "session",
  missing_credentials: "configuration",
  site_url_not_configured: "configuration",
  unknown_client: "configuration",
  unsupported_platform: "configuration",
  missing_refresh_token: "refresh-token",
  unauthorized: "permission",
  token_exchange_failed: "exchange",
};

function classifyOAuthFailure(code: string): OAuthFailureKind {
  return OAUTH_FAILURE_KINDS[code] ?? "unknown";
}

function credentialFormSourceIds(sources: readonly DataSourceCard[]): Set<string> {
  return new Set(
    sources
      .filter((source) => source.connectMethod === "credentials")
      .map((source) => source.id),
  );
}

export function readOAuthNotice(
  searchParams: SearchParamReader,
  credentialFormSources: ReadonlySet<string> = new Set(),
  sources: readonly DataSourceCard[] = [],
): ConsoleNotice | null {
  const connectedPlatform = searchParams.get("connected");
  const oauthStatus = searchParams.get("status");
  const oauthError = searchParams.get("oauth_error");
  const errorPlatform = searchParams.get("platform") ?? "google-ads";

  if (connectedPlatform && oauthStatus === "success" && !oauthError) {
    const platformName = OAUTH_PLATFORMS[connectedPlatform]?.name ?? "The connector";
    if (!sources.some((source) => source.id === connectedPlatform && source.status === "connected" && source.recovery !== "contact-owner")) {
      return {
        type: "warning",
        title: "Connection is not ready",
        message: "Authorization returned, but an active connector could not be confirmed. Review setup requirements before using live reports.",
      };
    }
    return {
      type: "success",
      title: "Connector authorized",
      message: `${platformName} is connected with its read-only OAuth scope.`,
    };
  }

  if (!oauthError) return null;

  const platformName = OAUTH_PLATFORMS[errorPlatform]?.name ?? "The connector";
  const kind = classifyOAuthFailure(oauthError);

  // A source now connected from the in-page form no longer depends on the
  // deployment's OAuth settings, so "ask the owner" would send the operator
  // away from a fix they can make themselves. An old link can still carry the
  // code; it is answered with the way that works.
  if (kind === "configuration" && credentialFormSources.has(errorPlatform) && !sources.some((source) => source.id === errorPlatform && source.recovery === "contact-owner")) {
    return {
      type: "warning",
      title: "Connect with API credentials",
      message: `${platformName} is connected per brand from this page. Choose Connect on the ${platformName} row and enter this brand's API credentials. Nothing was stored.`,
    };
  }

  // Every message is fixed copy chosen by code. Nothing from the query string
  // is shown verbatim: anyone can craft a link to this page, so echoing a
  // parameter would let that link put arbitrary text in a trusted notice.
  switch (kind) {
    case "cancelled":
      return {
        type: "warning",
        title: "Authorization cancelled",
        message: `${platformName} consent was not granted. No credential was stored.`,
      };
    case "session":
      return {
        type: "warning",
        title: "Authorization session expired",
        message: `The ${platformName} sign-in could not be matched to this browser session, so nothing was stored. Start the connection again from this page, in the same tab.`,
      };
    case "configuration":
      return {
        type: "error",
        title: "Deployment configuration required",
        message: `${platformName} cannot complete authorization until the deployment is configured. Re-authorizing will not help; ask the dashboard owner to check the server settings.`,
      };
    case "refresh-token":
      return {
        type: "warning",
        title: "Ongoing reporting access was not granted",
        message: `${platformName} did not grant the ongoing access needed to refresh reports automatically. Re-authorize and approve access again; your existing dashboard data is unchanged.`,
      };
    case "permission":
      return {
        type: "error",
        title: "Your role cannot connect data sources",
        message:
          "Connecting or re-authorizing a connector needs editor access. Nothing was changed; ask an administrator to connect it.",
      };
    case "exchange":
      return {
        type: "error",
        title: "Authorization was not completed",
        message: `${platformName} did not issue a credential, so nothing was stored. Try connecting once more; if it fails again, ask the dashboard owner.`,
      };
    default:
      return {
        type: "error",
        title: "Connector authorization failed",
        message: `${platformName} authorization stopped for an unrecognised reason. Nothing was stored.`,
      };
  }
}

function applyOAuthErrorState(
  initialSources: DataSourceCard[],
  searchParams: SearchParamReader,
): DataSourceCard[] {
  const oauthError = searchParams.get("oauth_error");
  if (!oauthError) return initialSources;

  // A cancelled consent, an expired session, or a role without permission
  // leaves the stored credential exactly as it was, so the row keeps its
  // real state instead of being painted as broken.
  const kind = classifyOAuthFailure(oauthError);
  const errorPlatform = searchParams.get("platform") ?? "google-ads";
  // Missing OAuth settings say nothing about a source connected from the form;
  // its row keeps its real state and the notice points at Connect.
  if (
    kind === "configuration" &&
    credentialFormSourceIds(initialSources).has(errorPlatform)
  ) {
    return initialSources;
  }
  const statusNote =
    kind === "refresh-token"
      ? "Automatic report refresh needs renewed access"
      : kind === "configuration"
        ? "Deployment configuration required"
        : kind === "exchange" || kind === "unknown"
          ? "Authorization requires attention"
          : null;
  if (!statusNote) return initialSources;

  // A deployment-configuration failure is the one error a re-authorize cannot
  // clear, so the row is told to point at the owner instead of at the OAuth
  // button. The notice above already says the same thing in words.
  const recovery: ConnectorRecovery =
    kind === "configuration" ? "contact-owner" : "re-authorize";

  return initialSources.map((source) =>
    source.id === errorPlatform
      ? { ...source, status: "error", statusNote, recovery }
      : source,
  );
}

function clearConnectorStatusCookie(sourceId: string): void {
  if (typeof document === "undefined") return;
  document.cookie = `connector_${sourceId}_status=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`;
}

function DataSourcesContent({
  accountName,
  clientSlug,
  sources: initialSources,
  health,
  lastDataSyncAt,
  syncTimeZone,
  viewer,
}: {
  accountName: string;
  clientSlug: string;
  sources: DataSourceCard[];
  health: ConnectorHealthReport | null;
  lastDataSyncAt: string | null;
  syncTimeZone: string;
  viewer: DashboardViewer;
}) {
  const searchParams = useSearchParams();
  const [sources, setSources] = useState(() =>
    applyOAuthErrorState(initialSources, searchParams),
  );
  const [notice, setNotice] = useState<ConsoleNotice | null>(() =>
    readOAuthNotice(searchParams, credentialFormSourceIds(initialSources), initialSources),
  );
  // The source whose credential form is open, if any.
  const [credentialSourceId, setCredentialSourceId] = useState<string | null>(() => {
    const id = searchParams.get("platform");
    return hasPermission(viewer.role, "sync:trigger") && searchParams.get("oauth_error") &&
      classifyOAuthFailure(searchParams.get("oauth_error")!) === "configuration" &&
      initialSources.some((source) => source.id === id && source.connectMethod === "credentials") ? id : null;
  });
  const [setupSourceId, setSetupSourceId] = useState<string | null>(() => {
    const id = searchParams.get("platform");
    return searchParams.get("oauth_error") && classifyOAuthFailure(searchParams.get("oauth_error")!) === "configuration"
      && initialSources.some((source) => source.id === id) &&
      !(hasPermission(viewer.role, "sync:trigger") && initialSources.some((source) => source.id === id && source.connectMethod === "credentials")) ? id : null;
  });
  // The OAuth redirect lands back on a row that otherwise looks exactly as it
  // did before. A short confirmation closes that loop, then the row settles
  // into its ordinary healthy state rather than keeping a permanent badge.
  const [verifiedSourceId, setVerifiedSourceId] = useState<string | null>(() =>
    searchParams.get("status") === "success" && !searchParams.get("oauth_error") && initialSources.some((source) => source.id === searchParams.get("connected") && source.status === "connected" && source.recovery !== "contact-owner")
      ? searchParams.get("connected")
      : null,
  );

  useEffect(() => {
    if (!verifiedSourceId) return undefined;
    const timer = window.setTimeout(() => setVerifiedSourceId(null), 6000);
    return () => window.clearTimeout(timer);
  }, [verifiedSourceId]);

  const [disconnectPendingId, setDisconnectPendingId] = useState<string | null>(null);
  const [loadingById, setLoadingById] = useState<Record<string, boolean>>({});
  const [testResults, setTestResults] = useState<
    Record<string, ConnectionTestState>
  >({});

  const activeSources = useMemo(
    () => sources.filter((source) => source.status !== "planned"),
    [sources],
  );
  const plannedSources = useMemo(
    () => sources.filter((source) => source.status === "planned"),
    [sources],
  );
  const connectedCount = activeSources.filter(
    (source) => source.status === "connected",
  ).length;
  const canManage = hasPermission(viewer.role, "sync:trigger");

  const handleAuthorize = useCallback(
    (sourceId: string) => {
      const source = sources.find((item) => item.id === sourceId);
      if ((source?.recovery === "contact-owner" || source?.status === "unverified") && source.connectMethod !== "credentials") {
        setSetupSourceId(sourceId);
        return;
      }
      // A form-connected source opens its form in place. Sending it to the
      // OAuth route would fail on a deployment without OAuth settings, which
      // is exactly the dead end the form replaces.
      if (
        sources.some(
          (source) => source.id === sourceId && source.connectMethod === "credentials",
        )
      ) {
        setCredentialSourceId(sourceId);
        return;
      }
      setLoadingById((current) => ({ ...current, [sourceId]: true }));
      window.location.assign(`/api/connectors/oauth/${sourceId}/authorize?client=${encodeURIComponent(clientSlug)}`);
    },
    [sources, clientSlug],
  );

  const handleRequestDisconnect = useCallback((sourceId: string) => {
    setDisconnectPendingId(sourceId);
  }, []);

  const handleCancelDisconnect = useCallback(() => {
    setDisconnectPendingId(null);
  }, []);

  const handleConfirmDisconnect = useCallback(async (sourceId: string) => {
    setLoadingById((current) => ({ ...current, [sourceId]: true }));
    try {
      // The brand in view is sent explicitly. Omitted, the route falls back to
      // the pilot brand, which would revoke the pilot's credential while the
      // operator is looking at another brand's row.
      const response = await fetch("/api/connectors/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform: sourceId, client: clientSlug }),
      });
      const body = (await response.json()) as {
        error?: string;
        message?: string;
      };

      if (!response.ok) {
        setNotice({
          type: "error",
          title: "Disconnect failed",
          message: body.error ?? "The stored credential could not be revoked.",
        });
        return;
      }

      clearConnectorStatusCookie(sourceId);
      setSources((current) =>
        current.map((source) =>
          source.id === sourceId
            ? {
                ...source,
                status: "disconnected",
                statusNote: "No active credential",
                lastSyncedAt: null,
                targetAccount: null,
                credential: undefined,
              }
            : source,
        ),
      );
      setNotice({
        type: "success",
        title: "Connector disconnected",
        message: body.message ?? "The stored credential was revoked.",
      });
      setDisconnectPendingId(null);
    } catch {
      setNotice({
        type: "error",
        title: "Network error",
        message: "The disconnect endpoint could not be reached. The credential remains active.",
      });
    } finally {
      setLoadingById((current) => ({ ...current, [sourceId]: false }));
    }
  }, [clientSlug]);

  const handleTestConnection = useCallback(async (sourceId: string) => {
    setTestResults((current) => ({
      ...current,
      [sourceId]: { status: "loading" },
    }));

    try {
      // Explicit brand, so the test answers for the row on screen rather than
      // for whatever the selector cookie last said.
      const response = await fetch("/api/connectors/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform: sourceId, client: clientSlug }),
      });
      const body = (await response.json()) as {
        ok?: boolean;
        safeMessage?: string;
        error?: string;
        testedAt?: string;
      };

      if (response.ok && body.ok) {
        setTestResults((current) => ({
          ...current,
          [sourceId]: {
            status: "success",
            message: body.safeMessage ?? "Credential authenticated successfully.",
            testedAt: body.testedAt ?? new Date().toISOString(),
          },
        }));
        return;
      }

      setTestResults((current) => ({
        ...current,
        [sourceId]: {
          status: "error",
          message: body.error ?? body.safeMessage ?? "Connection test failed.",
        },
      }));
    } catch {
      setTestResults((current) => ({
        ...current,
        [sourceId]: {
          status: "error",
          message: "The connection test endpoint could not be reached.",
        },
      }));
    }
  }, [clientSlug]);

  const handleCredentialsSaved = useCallback(
    (result: SavedCredentialsResult) => {
      const sourceId = credentialSourceId ?? result.platform;
      setCredentialSourceId(null);
      setSources((current) =>
        current.map((source) =>
          source.id === sourceId
            ? {
                ...source,
                status: "connected",
                statusNote: "Credential stored and active",
                lastSyncedAt: result.savedAt,
                targetAccount: result.targetAccount,
                recovery: undefined,
                credential: sourceId === "meta-ads" && result.expiresAt ? {
                  kind: "long-lived-access-token",
                  state: "active",
                  expiresAt: result.expiresAt,
                  daysRemaining: Math.max(0, Math.ceil((Date.parse(result.expiresAt) - Date.now()) / 86_400_000)),
                } : undefined,
              }
            : source,
        ),
      );
      setNotice({
        type: result.auditRecorded && !health?.liveSyncLocked ? "success" : "warning",
        title: "API access verified and credentials saved",
        message: `${sources.find((source) => source.id === sourceId)?.name ?? "Connector"} reporting access is verified. ${health?.liveSyncLocked ? "Live reporting is still locked by workspace runtime settings; these credentials are saved for this brand. " : ""}${result.auditRecorded ? "" : "The activity log could not record the change; ask the workspace owner to complete the audit trail."}`,
      });
      // A reload of this URL must not repaint the error an old OAuth attempt
      // left in the query string over the connection that now works.
      if (typeof window !== "undefined" && window.location.search) {
        const url = new URL(window.location.href);
        for (const key of ["oauth_error", "platform", "connected", "status"]) {
          url.searchParams.delete(key);
        }
        window.history.replaceState(window.history.state, "", url);
      }
      // The save was verified before it was stored; this confirms the same
      // thing from the stored row, through the path every sync will take.
      if (sources.find((source) => source.id === sourceId)?.testable) void handleTestConnection(sourceId);
    },
    [credentialSourceId, handleTestConnection, health, sources],
  );

  const credentialSource = credentialSourceId
    ? sources.find((source) => source.id === credentialSourceId) ?? null
    : null;

  return (
    <AppFrame
      activeHref="/data-sources"
      gateLabel="Read-only connector policy"
      gateNote="Connector credentials are stored server-side and every connector remains read-only."
      topbar={
        <>
          <div className="topbar__context">
            <span
              className={`status-dot ${
                connectedCount > 0 ? "status-dot--positive" : "status-dot--warning"
              }`}
            />
            <span>Active connectors</span>
            <strong>{connectedCount}/{activeSources.length}</strong>
          </div>
          {/* This timestamp is the newest credential change, not a data sync. */}
          <AccountSyncTime
            emptyLabel="None yet"
            label="Credential updated"
            lastSyncAt={lastDataSyncAt}
            timeZone={syncTimeZone}
          />
        </>
      }
      viewer={viewer}
    >
      <header className="console-page-header">
        <div>
          {/* Same name as the sidebar entry, so the page is where the menu said. */}
          <span className="eyebrow">Workspace / Connections</span>
          <h1>Data sources</h1>
          <p>Connector state, account scope, and recovery actions in one operational view.</p>
        </div>
        <ul aria-label="Connector policy" className="console-page-header__policy">
          <li>OAuth 2.0</li>
          <li>Read only</li>
          {/*
            The deployment data mode, shown once for the whole page. It used to
            repeat on every connector row, and a viewer without the health
            report saw their role printed where a mode belongs.
          */}
          {health && <li>{health.mode === "live" ? "Live data" : "Mock data"}</li>}
        </ul>
      </header>

      {notice && (
        <div
          aria-live="polite"
          className={`console-notice console-notice--${notice.type}`}
          role={notice.type === "error" ? "alert" : "status"}
        >
          <div>
            <strong>{notice.title}</strong>
            <p>{notice.message}</p>
          </div>
          <button
            aria-label="Dismiss connector notice"
            className="console-notice__dismiss"
            onClick={() => setNotice(null)}
            type="button"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className={`connector-workspace${health ? " connector-workspace--with-runtime" : ""}`}>
      <ConnectorConsole
        activeSources={activeSources}
        canManage={canManage}
        disconnectPendingId={disconnectPendingId}
        loadingById={loadingById}
        onAuthorize={handleAuthorize}
        onCancelDisconnect={handleCancelDisconnect}
        onConfirmDisconnect={handleConfirmDisconnect}
        onRequestDisconnect={handleRequestDisconnect}
        onTest={handleTestConnection}
        onSetup={(sourceId) => {
          if (canManage && sources.find((source) => source.id === sourceId)?.connectMethod === "credentials") setCredentialSourceId(sourceId);
          else setSetupSourceId(sourceId);
        }}
        plannedSources={plannedSources}
        testResults={testResults}
        timeZone={syncTimeZone}
        verifiedSourceId={verifiedSourceId}
      />

      {health && <ConnectorRuntimePanel health={health} />}
      </div>

      <ConnectorSetupDialog
        source={sources.find((source) => source.id === setupSourceId) ?? null}
        accountName={accountName}
        canManage={canManage}
        onClose={() => setSetupSourceId(null)}
      />

      {canManage && (
        <ConnectorCredentialsModal
          key={credentialSourceId ?? "closed"}
          accountName={accountName}
          clientSlug={clientSlug}
          onClose={() => setCredentialSourceId(null)}
          onSaved={handleCredentialsSaved}
          open={credentialSource !== null}
          platform={(credentialSource?.id ?? "google-ads") as DirectConnectorPlatform}
          setup={credentialSource?.setup}
        />
      )}
    </AppFrame>
  );
}

function ConnectorSetupDialog({ source, accountName, canManage, onClose }: {
  source: DataSourceCard | null;
  accountName: string;
  canManage: boolean;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const dialog = dialogRef.current;
    if (source && dialog && !dialog.open) {
      dialog.showModal();
      dialog.scrollTop = 0;
    }
    if (!source && dialog?.open) dialog.close();
  }, [source]);
  return (
    <dialog ref={dialogRef} className="connector-setup-dialog" aria-labelledby={titleId} aria-describedby={descriptionId} onCancel={onClose} onClose={onClose}>
      {source && <>
        <header className="connector-setup-dialog__header">
          <div>
            <span className="eyebrow">{accountName}</span>
            <h2 id={titleId}>{source.name} setup requirements</h2>
          </div>
          <button className="console-button console-button--quiet" type="button" onClick={onClose} aria-label="Close setup requirements">Close</button>
        </header>
        <p id={descriptionId}>This connector is not ready for live reporting. The dashboard owner must complete the requirements below, then return to Data sources to authorize access.</p>
        <p className="connector-setup-dialog__notice">{canManage ? "Configure secrets in the server's environment settings, then redeploy. " : "You have view-only access. Share this checklist with the dashboard owner. "}Only setting names and presence are shown here; never paste secrets into worklogs or messages.</p>
        <h3>Deployment settings</h3>
        <ul className="connector-setup-dialog__settings">
          {source.setup?.settings.map((setting) => <li key={setting.name}>
            <code>{setting.name}</code><span className={setting.configured ? "setup-present" : "setup-missing"}>{setting.configured ? "Present · not validated" : "Missing"}</span>
          </li>)}
        </ul>
        <h3>Provider and account checklist</h3>
        <ol>{(source.setup?.requirements ?? ["Configure provider credentials, read-only permissions, account mapping, and the OAuth callback before connecting."]).map((requirement) => <li key={requirement}>{requirement}</li>)}</ol>
        {source.connectMethod !== "credentials" && <>
          <h3>Exact OAuth callback</h3>
          <code className="connector-setup-dialog__callback">{source.setup?.callbackUrl ?? "Set a valid NEXT_PUBLIC_SITE_URL first; the callback will appear here."}</code>
        </>}
        <h3>Confirm reporting readiness</h3>
        <p>Reload this page after deployment. Authorize the correct brand, verify its stored credential and account mapping, then check the runtime live-sync gate. Authorization alone does not enable live reporting. Demo mode stays labelled until live data is available.</p>
        <footer>
          {source.setup?.documentationUrl && <a className="console-button console-button--quiet" href={source.setup.documentationUrl} target="_blank" rel="noreferrer">Provider documentation ↗</a>}
          <button className="console-button console-button--primary" type="button" onClick={onClose}>Got it</button>
        </footer>
      </>}
    </dialog>
  );
}

export function DataSourcesShell(props: {
  accountName: string;
  clientSlug: string;
  sources: DataSourceCard[];
  health: ConnectorHealthReport | null;
  lastDataSyncAt: string | null;
  syncTimeZone: string;
  viewer: DashboardViewer;
}) {
  return (
    <Suspense fallback={<div className="console-loading">Loading connectors…</div>}>
      <DataSourcesContent key={props.clientSlug} {...props} />
    </Suspense>
  );
}
