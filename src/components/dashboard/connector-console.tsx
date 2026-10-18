"use client";

import {
  memo,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import { formatSyncTimestamp } from "@/components/dashboard/clocks";
import {
  StoreSourceIcon,
  BingAdsIcon,
  Ga4Icon,
  GoogleAdsIcon,
  GoogleSearchConsoleIcon,
  MetaAdsIcon,
  ShopifyIcon,
  TikTokAdsIcon,
} from "@/components/dashboard/icons";

/**
 * `unverified` means this deployment cannot read the connector's stored state
 * (for example, the server worker secret is not configured). It is neither a
 * failure nor a connection, so it is shown as neutral, never as an error.
 */
export type ConnectorState =
  | "connected"
  | "disconnected"
  | "error"
  | "planned"
  | "unverified";

export type LongLivedCredential =
  | {
      kind: "long-lived-access-token";
      state: "active";
      daysRemaining: number;
      expiresAt: string;
    }
  | {
      kind: "long-lived-access-token";
      state: "expired";
      daysRemaining: 0;
      expiresAt: string;
    }
  | {
      kind: "long-lived-access-token";
      state: "expiry-unknown";
      daysRemaining: null;
      expiresAt: null;
    };

/**
 * What actually fixes this connector. A deployment that is missing server
 * configuration also reports `status: "error"`, but re-authorizing it cannot
 * help — the page notice already says so in words, and offering a
 * "Re-authorize now" button beside that sentence would contradict it.
 */
export type ConnectorRecovery = "re-authorize" | "contact-owner";

/**
 * How an operator connects this source. `oauth` leaves for the provider's
 * consent screen; `credentials` opens the in-page form, so the operator can
 * connect a brand without anyone editing the deployment's settings.
 */
export type ConnectMethod = "oauth" | "credentials";

export interface DataSourceCard {
  id: string;
  name: string;
  purpose: string;
  status: ConnectorState;
  statusNote: string;
  lastSyncedAt: string | null;
  targetAccount: string | null;
  testable?: boolean;
  credential?: LongLivedCredential;
  recovery?: ConnectorRecovery;
  /** Absent means `oauth`. */
  connectMethod?: ConnectMethod;
  /** Safe names and presence only; credential values never reach the browser. */
  setup?: {
    settings: { name: string; configured: boolean }[];
    requirements: string[];
    callbackUrl: string | null;
    documentationUrl: string;
    oauthDefaults?: { clientConfigured: boolean; developerTokenConfigured: boolean };
  };
}

export type ConnectionTestState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; message: string; testedAt: string }
  | { status: "error"; message: string };

interface ConnectorConsoleProps {
  activeSources: DataSourceCard[];
  plannedSources: DataSourceCard[];
  canManage: boolean;
  disconnectPendingId: string | null;
  loadingById: Record<string, boolean>;
  testResults: Record<string, ConnectionTestState>;
  timeZone: string;
  /**
   * The connector this browser just returned from authorizing. Its row shows a
   * short-lived confirmation instead of the ordinary action, so the redirect
   * ends in an answer rather than in a row that looks unchanged.
   */
  verifiedSourceId?: string | null;
  onAuthorize: (sourceId: string) => void;
  onCancelDisconnect: () => void;
  onConfirmDisconnect: (sourceId: string) => void;
  onRequestDisconnect: (sourceId: string) => void;
  onTest: (sourceId: string) => void;
  onSetup?: (sourceId: string) => void;
}

const STATUS_LABELS: Record<ConnectorState, string> = {
  connected: "Connected",
  disconnected: "Disconnected",
  error: "Error",
  planned: "Planned",
  unverified: "Status unavailable",
};

const GLYPH_LABELS: Record<string, string> = {
  "bing-ads": "MS",
  "tiktok-ads": "TT",
  "google-analytics": "GA4",
  "google-search-console": "GSC",
  shopify: "SHO",
  "store": "Store",
};

export function longLivedCredentialLabel(
  credential: LongLivedCredential,
): string {
  if (credential.state === "expired") {
    return "Long-lived access token expired · re-authenticate to resume reporting";
  }
  if (credential.state === "expiry-unknown") {
    return "Long-lived access token active · expiry date unavailable";
  }
  const days = credential.daysRemaining === 1 ? "1 day" : `${credential.daysRemaining} days`;
  return `Long-lived access token active · expires in ${days}`;
}

/**
 * Mirrors `TOKEN_EXPIRY_WARNING_DAYS` in `@/lib/connectors/token-storage`. That
 * module reaches the service-role Supabase client, so a client component cannot
 * import it; a test asserts the two numbers stay equal.
 */
export const CREDENTIAL_EXPIRY_WARNING_DAYS = 7;

/**
 * What the row should ask the operator to do, which is not the same question as
 * "is this connector connected".
 *
 * A healthy connector needs no recovery action on the surface at all. Showing a
 * permanent "Re-authorize" button beside a green chip reads as "this is not
 * really connected", which is the confusion this state machine removes.
 */
export type ConnectorAuthorizationState =
  | "healthy"
  | "expiring-soon"
  | "reauth-required"
  | "configuration-blocked";

export function resolveConnectorAuthorizationState(
  source: DataSourceCard,
  testState: ConnectionTestState = { status: "idle" },
): ConnectorAuthorizationState {
  // An unverified row has nothing to recover: re-authorizing cannot fix a
  // deployment that is unable to read connector state.
  if (
    source.status === "planned" ||
    source.status === "disconnected" ||
    source.status === "unverified"
  ) {
    return "healthy";
  }

  // Per-brand credentials bypass deployment OAuth settings, but still require
  // working server storage. A blocked storage gate opens the same checklist.
  if (
    source.status === "error" &&
    source.recovery === "contact-owner" &&
    (source.connectMethod !== "credentials" || source.setup?.settings.some((setting) => !setting.configured))
  ) {
    return "configuration-blocked";
  }

  if (source.credential?.state === "expired" || source.status === "error") {
    return "reauth-required";
  }

  // A failed connection test is evidence the stored credential stopped working
  // even while the row still reads as connected.
  if (testState.status === "error") return "reauth-required";

  if (
    source.credential?.state === "active" &&
    source.credential.daysRemaining <= CREDENTIAL_EXPIRY_WARNING_DAYS
  ) {
    return "expiring-soon";
  }

  return "healthy";
}

/** Chip text and modifier, so the badge and the button never disagree. */
export function connectorChipPresentation(
  source: DataSourceCard,
  authorizationState: ConnectorAuthorizationState,
): { label: string; modifier: string } {
  if (authorizationState === "configuration-blocked") {
    return { label: "Config required", modifier: "disconnected" };
  }

  if (authorizationState === "reauth-required") {
    return { label: "Re-auth required", modifier: "error" };
  }

  if (
    authorizationState === "expiring-soon" &&
    source.credential?.state === "active"
  ) {
    return {
      label: `Expiring in ${source.credential.daysRemaining}d`,
      modifier: "expiring",
    };
  }

  return {
    label: STATUS_LABELS[source.status],
    modifier: source.status === "unverified" ? "neutral" : source.status,
  };
}

const ConnectorGlyph = memo(function ConnectorGlyph({
  source,
}: {
  source: DataSourceCard;
}) {
  if (source.id === "google-ads") {
    return <GoogleAdsIcon className="connector-glyph__icon" />;
  }

  if (source.id === "meta-ads") {
    return <MetaAdsIcon className="connector-glyph__icon" />;
  }

  if (source.id === "bing-ads") {
    return <BingAdsIcon className="connector-glyph__icon" />;
  }

  if (source.id === "tiktok-ads") {
    return <TikTokAdsIcon className="connector-glyph__icon" />;
  }

  if (source.id === "google-analytics") {
    return <Ga4Icon className="connector-glyph__icon" />;
  }

  if (source.id === "store" || source.id === "woocommerce") {
    return <StoreSourceIcon className="connector-glyph__icon" />;
  }

  if (source.id === "shopify") {
    return <ShopifyIcon className="connector-glyph__icon" />;
  }

  if (source.id === "google-search-console") {
    return <GoogleSearchConsoleIcon className="connector-glyph__icon" />;
  }

  return (
    <span className="connector-glyph__text" aria-hidden="true">
      {GLYPH_LABELS[source.id] ?? source.name.slice(0, 2).toUpperCase()}
    </span>
  );
});

interface ManageMenuItem {
  id: string;
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export type ManageActionId = "test" | "reauthorize" | "disconnect";

/**
 * Which actions live in the overflow tray, given what the row already shows on
 * its surface. Exported so the split can be asserted directly: a static render
 * cannot open the tray, and "Test connection is on the surface exactly when it
 * is not in the tray" is the invariant worth protecting.
 */
export function resolveManageActionIds(
  source: DataSourceCard,
  authorizationState: ConnectorAuthorizationState,
): ManageActionId[] {
  if (authorizationState === "configuration-blocked") return [];
  // A healthy row keeps Test connection on the surface, so repeating it in the
  // tray would offer the same action twice.
  const testIsOnSurface = authorizationState === "healthy";
  return [
    ...(source.testable && !testIsOnSurface
      ? (["test"] as ManageActionId[])
      : []),
    "reauthorize",
    "disconnect",
  ];
}

/**
 * Trigger and tray are separate because `.integration-group` clips its
 * overflow to keep its rounded corners, which would cut a floating panel off
 * at the last row. The tray is therefore a row-level strip — the same
 * mechanism `.connector-row__test-result` already uses — so it can never be
 * clipped and behaves identically at 1440px and 390px.
 */
function ConnectorManageTrigger({
  isOpen,
  menuId,
  sourceName,
  triggerRef,
  onToggle,
}: {
  isOpen: boolean;
  menuId: string;
  sourceName: string;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  onToggle: () => void;
}) {
  return (
    <button
      aria-controls={isOpen ? menuId : undefined}
      aria-expanded={isOpen}
      aria-haspopup="menu"
      aria-label={`More actions for ${sourceName}`}
      className="console-button console-button--quiet connector-manage__trigger"
      onClick={onToggle}
      ref={triggerRef}
      type="button"
    >
      Manage
      <span aria-hidden="true" className="connector-manage__caret">
        ▾
      </span>
    </button>
  );
}

function ConnectorManageTray({
  items,
  menuId,
  panelRef,
  onClose,
}: {
  items: ManageMenuItem[];
  menuId: string;
  panelRef: React.RefObject<HTMLDivElement | null>;
  onClose: (returnFocus: boolean) => void;
}) {
  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose(true);
      return;
    }

    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const focusable = [
      ...(panelRef.current?.querySelectorAll<HTMLElement>(
        '[role="menuitem"]:not([disabled])',
      ) ?? []),
    ];
    if (focusable.length === 0) return;

    event.preventDefault();
    const current = focusable.indexOf(document.activeElement as HTMLElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    focusable[(current + step + focusable.length) % focusable.length]?.focus();
  }

  return (
    <div
      className="connector-manage__tray"
      id={menuId}
      onKeyDown={onKeyDown}
      ref={panelRef}
      role="menu"
    >
      {items.map((item) => (
        <button
          className={`connector-manage__item${
            item.danger ? " connector-manage__item--danger" : ""
          }`}
          disabled={item.disabled}
          key={item.id}
          onClick={() => {
            onClose(true);
            item.onSelect();
          }}
          role="menuitem"
          type="button"
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

const ConnectorRow = memo(function ConnectorRow({
  canManage,
  disconnectPending,
  isLoading,
  isVerified,
  source,
  testState,
  timeZone,
  onAuthorize,
  onCancelDisconnect,
  onConfirmDisconnect,
  onRequestDisconnect,
  onTest,
  onSetup,
}: {
  canManage: boolean;
  disconnectPending: boolean;
  isLoading: boolean;
  isVerified: boolean;
  source: DataSourceCard;
  testState: ConnectionTestState;
  timeZone: string;
  onAuthorize: (sourceId: string) => void;
  onCancelDisconnect: () => void;
  onConfirmDisconnect: (sourceId: string) => void;
  onRequestDisconnect: (sourceId: string) => void;
  onTest: (sourceId: string) => void;
  onSetup?: (sourceId: string) => void;
}) {
  const isConnected = source.status === "connected";
  const isPlanned = source.status === "planned";
  const credentialExpired = source.credential?.state === "expired";
  const usesCredentialForm = source.connectMethod === "credentials";
  // An expired long-lived token is re-authenticated; a broken grant is
  // re-authorized. The distinction is the operator's, not ours, so it is kept.
  const recoveryVerb = credentialExpired ? "Re-authenticate" : "Re-authorize";
  // A form-connected source has no consent to repeat: its recovery is typing a
  // working credential set, and the labels say so.
  const recoveryLabel = usesCredentialForm ? "Update credentials" : `${recoveryVerb} now`;
  const trayRecoveryLabel = usesCredentialForm
    ? "Edit credentials"
    : `${recoveryVerb} connection`;

  const [isManageOpen, setIsManageOpen] = useState(false);
  const rowRef = useRef<HTMLLIElement>(null);
  const manageTriggerRef = useRef<HTMLButtonElement>(null);
  const managePanelRef = useRef<HTMLDivElement>(null);
  const manageMenuId = useId();

  const closeManage = useCallback((returnFocus: boolean) => {
    setIsManageOpen(false);
    if (returnFocus) manageTriggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!isManageOpen) return undefined;

    function onPointerDown(event: MouseEvent) {
      if (!rowRef.current?.contains(event.target as Node)) {
        setIsManageOpen(false);
      }
    }

    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [isManageOpen]);

  useEffect(() => {
    if (!isManageOpen) return;
    managePanelRef.current
      ?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')
      ?.focus();
  }, [isManageOpen]);

  const authorizationState = resolveConnectorAuthorizationState(
    source,
    testState,
  );
  const chip = connectorChipPresentation(source, authorizationState);
  // The tray renders as a sibling of the actions cell, so it must be tied to
  // the same condition as its trigger — otherwise a state change could leave an
  // open tray on a row that no longer shows the button that opens it.
  const showsManage =
    !isPlanned &&
    canManage &&
    !disconnectPending &&
    !isVerified &&
    (isConnected || authorizationState !== "healthy") &&
    authorizationState !== "configuration-blocked";

  const manageTrigger = (
    <ConnectorManageTrigger
      isOpen={isManageOpen}
      menuId={manageMenuId}
      onToggle={() => (isManageOpen ? closeManage(true) : setIsManageOpen(true))}
      sourceName={source.name}
      triggerRef={manageTriggerRef}
    />
  );

  // Re-authorize leaves the surface when the connection is healthy: that is the
  // whole point of this hierarchy. It stays one keystroke away in the tray for
  // the operator who deliberately wants to rotate a working credential.
  const manageActions: Record<ManageActionId, ManageMenuItem> = {
    test: {
      id: "test",
      label: testState.status === "loading" ? "Testing…" : "Test connection",
      onSelect: () => onTest(source.id),
      disabled: isLoading || testState.status === "loading",
    },
    reauthorize: {
      id: "reauthorize",
      label: trayRecoveryLabel,
      onSelect: () => onAuthorize(source.id),
      disabled: isLoading,
    },
    disconnect: {
      id: "disconnect",
      label: "Disconnect",
      onSelect: () => onRequestDisconnect(source.id),
      danger: true,
      disabled: isLoading,
    },
  };

  const manageItems = resolveManageActionIds(source, authorizationState).map(
    (id) => manageActions[id],
  );

  return (
    <li
      className={`connector-row connector-row--${source.status}`}
      id={`connector-row-${source.id}`}
      data-connector-id={source.id}
      ref={rowRef}
    >
      <div className="connector-row__identity">
        <span className={`connector-glyph connector-glyph--${source.id}`}>
          <ConnectorGlyph source={source} />
        </span>
        <span className="connector-row__name">
          <strong>{source.name}</strong>
          <small>{source.purpose}</small>
        </span>
      </div>

      <div className="connector-row__datum">
        <span className="connector-row__mobile-label">Connection</span>
        <span className={`signal-chip signal-chip--${chip.modifier}`}>
          <span aria-hidden="true" className="signal-chip__dot" />
          {chip.label}
        </span>
        <small className="connector-row__status-note">{source.statusNote}</small>
      </div>

      <div className="connector-row__datum connector-row__datum--time">
        <span className="connector-row__mobile-label">Credential updated</span>
        {source.lastSyncedAt ? (
          <time dateTime={source.lastSyncedAt}>
            {formatSyncTimestamp(source.lastSyncedAt, timeZone)}
          </time>
        ) : (
          <span className="connector-row__empty">Never</span>
        )}
      </div>

      <div className="connector-row__datum">
        <span className="connector-row__mobile-label">Target account</span>
        <span className="connector-row__target">
          {source.targetAccount ?? "Not assigned"}
        </span>
      </div>

      <div className="connector-row__actions">
        {isPlanned ? (
          <span className="connector-row__roadmap">Roadmap connector</span>
        ) : authorizationState === "configuration-blocked" || source.status === "unverified" ? (
          <button
            className={`console-button ${canManage && source.connectMethod === "credentials" ? "console-button--primary" : "console-button--quiet"}`}
            onClick={() => onSetup?.(source.id)}
            type="button"
          >
            {canManage && usesCredentialForm ? "Configure connection" : "View setup requirements"}
          </button>
        ) : !canManage ? (
          <span className="connector-row__roadmap">Editor access required</span>
        ) : disconnectPending ? (
          <>
            <span className="connector-row__confirm-copy">Revoke stored credential?</span>
            <button
              className="console-button console-button--danger"
              disabled={isLoading}
              onClick={() => onConfirmDisconnect(source.id)}
              type="button"
            >
              {isLoading ? "Revoking…" : "Confirm"}
            </button>
            <button
              className="console-button console-button--quiet"
              disabled={isLoading}
              onClick={onCancelDisconnect}
              type="button"
            >
              Cancel
            </button>
          </>
        ) : isVerified && isConnected && authorizationState === "healthy" ? (
          <span className="connector-row__verified" role="status">
            <span aria-hidden="true">✓</span> Verified
          </span>
        ) : isConnected || authorizationState === "reauth-required" ? (
          <>
            {authorizationState === "reauth-required" ? (
              <button
                className="console-button console-button--primary"
                disabled={isLoading}
                onClick={() => onAuthorize(source.id)}
                type="button"
              >
                {isLoading ? "Opening…" : recoveryLabel}
              </button>
            ) : authorizationState === "expiring-soon" ? (
              <button
                className="console-button console-button--warning"
                disabled={isLoading}
                onClick={() => onAuthorize(source.id)}
                type="button"
              >
                {isLoading ? "Opening…" : "Renew access"}
              </button>
            ) : (
              source.testable && (
                <button
                  className="console-button console-button--quiet"
                  disabled={isLoading || testState.status === "loading"}
                  onClick={() => onTest(source.id)}
                  type="button"
                >
                  {testState.status === "loading"
                    ? "Testing…"
                    : "Test connection"}
                </button>
              )
            )}
            {manageTrigger}
          </>
        ) : source.id === "store" || source.id === "woocommerce" ? (
          <span className="connector-row__roadmap">API in development</span>
        ) : (
          <>
            <button
              aria-describedby={`connector-oauth-hint-${source.id}`}
              className="console-button console-button--primary"
              disabled={isLoading}
              onClick={() => onAuthorize(source.id)}
              type="button"
            >
              {isLoading ? "Opening…" : usesCredentialForm ? "Connect" : "Connect OAuth"}
            </button>
            {/*
              Say before the click what the button does: leave the dashboard for
              the provider's consent page, or open a form on this one. That is
              the difference between a deliberate step and a surprise.
            */}
            <small
              className="connector-row__oauth-hint"
              id={`connector-oauth-hint-${source.id}`}
            >
              {usesCredentialForm
                ? "Enter API credentials · stored server-side"
                : `Opens ${source.name} sign-in · read-only access`}
            </small>
          </>
        )}
      </div>

      {showsManage && isManageOpen && (
        <ConnectorManageTray
          items={manageItems}
          menuId={manageMenuId}
          onClose={closeManage}
          panelRef={managePanelRef}
        />
      )}

      {source.credential && (
        <div
          className={`connector-token-badge connector-token-badge--${source.credential.state}`}
        >
          <span aria-hidden="true" className="connector-token-badge__dot" />
          <span>{longLivedCredentialLabel(source.credential)}</span>
          {source.credential.expiresAt && (
            <time className="sr-only" dateTime={source.credential.expiresAt}>
              Token expiry {source.credential.expiresAt}
            </time>
          )}
        </div>
      )}

      {testState.status !== "idle" && testState.status !== "loading" && (
        <p
          aria-live="polite"
          className={`connector-row__test-result connector-row__test-result--${testState.status}`}
        >
          {testState.message}
          {testState.status === "success" && (
            <time dateTime={testState.testedAt}>
              Tested {formatSyncTimestamp(testState.testedAt, timeZone)}
            </time>
          )}
        </p>
      )}
    </li>
  );
});

function ConnectorGroup({
  canManage,
  description,
  disconnectPendingId,
  loadingById,
  sources,
  testResults,
  timeZone,
  title,
  verifiedSourceId,
  onAuthorize,
  onCancelDisconnect,
  onConfirmDisconnect,
  onRequestDisconnect,
  onTest,
  onSetup,
}: Omit<ConnectorConsoleProps, "activeSources" | "plannedSources"> & {
  title: string;
  description: string;
  sources: DataSourceCard[];
}) {
  return (
    <section className="integration-group" aria-labelledby={`${title.toLowerCase().replaceAll(" ", "-")}-title`}>
      <header className="integration-group__header">
        <div>
          <h2 id={`${title.toLowerCase().replaceAll(" ", "-")}-title`}>{title}</h2>
          <p>{description}</p>
        </div>
        <span className="integration-group__count">{sources.length}</span>
      </header>
      <div className="connector-columns" aria-hidden="true">
        <span>Connector</span>
        <span>Connection</span>
        <span>Credential updated</span>
        <span>Target account</span>
        <span>Actions</span>
      </div>
      <ul className="connector-list">
        {sources.map((source) => (
          <ConnectorRow
            canManage={canManage}
            disconnectPending={disconnectPendingId === source.id}
            isLoading={Boolean(loadingById[source.id])}
            isVerified={verifiedSourceId === source.id}
            key={source.id}
            onAuthorize={onAuthorize}
            onCancelDisconnect={onCancelDisconnect}
            onConfirmDisconnect={onConfirmDisconnect}
            onRequestDisconnect={onRequestDisconnect}
            onTest={onTest}
            onSetup={onSetup}
            source={source}
            testState={testResults[source.id] ?? { status: "idle" }}
            timeZone={timeZone}
          />
        ))}
      </ul>
    </section>
  );
}

export const ConnectorConsole = memo(function ConnectorConsole({
  activeSources,
  plannedSources,
  ...sharedProps
}: ConnectorConsoleProps) {
  return (
    <div className="integration-console">
      <ConnectorGroup
        {...sharedProps}
        description="Connectors supported by the current reporting pipeline."
        sources={activeSources}
        title="Active connectors"
      />
      <ConnectorGroup
        {...sharedProps}
        description="Visible for roadmap clarity; no credential action is exposed."
        sources={plannedSources}
        title="Planned"
      />
    </div>
  );
});
