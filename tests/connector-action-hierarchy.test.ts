import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  CREDENTIAL_EXPIRY_WARNING_DAYS,
  ConnectorConsole,
  connectorChipPresentation,
  resolveConnectorAuthorizationState,
  resolveManageActionIds,
  type ConnectionTestState,
  type DataSourceCard,
} from "../src/components/dashboard/connector-console";
import { readOAuthNotice } from "../src/components/dashboard/data-sources-shell";

test("a success URL cannot confirm a connector that is missing configuration", () => {
  const params = new URLSearchParams("connected=meta-ads&status=success");
  const blocked = card({ id: "meta-ads", status: "error", recovery: "contact-owner" });
  const notice = readOAuthNotice(params, new Set(), [blocked]);
  assert.equal(notice?.type, "warning");
  assert.equal(notice?.title, "Connection is not ready");
  assert.equal(readOAuthNotice(params)?.type, "warning");
  assert.equal(readOAuthNotice(params, new Set(), [card({ id: "meta-ads" })])?.type, "success");
  params.set("oauth_error", "missing_credentials");
  params.set("platform", "meta-ads");
  assert.equal(readOAuthNotice(params, new Set(), [card({ id: "meta-ads" })])?.type, "error");
});

test("a credential form still needs server storage before it can connect", () => {
  const source = card({
    connectMethod: "credentials", status: "error", recovery: "contact-owner",
    setup: { settings: [{ name: "SUPABASE_SERVICE_ROLE_KEY", configured: false }], callbackUrl: null, requirements: [], documentationUrl: "https://developers.google.com/google-ads/api/docs/get-started/introduction" },
  });
  assert.equal(resolveConnectorAuthorizationState(source), "configuration-blocked");
  assert.deepEqual(connectorChipPresentation(source, "configuration-blocked"), {
    label: "Config required", modifier: "disconnected",
  });
  assert.match(render(source, { canManage: false }), /View setup requirements/);
  assert.doesNotMatch(render(source), />Connect</);
});

/**
 * A permanent "Re-authorize" button beside a green chip told the operator the
 * connection was not really connected. These tests lock the hierarchy that
 * replaced it: on a healthy row the recovery action is in the overflow tray,
 * and it only comes back to the surface when the credential actually needs it.
 */

const healthy: DataSourceCard = {
  id: "google-ads",
  name: "Google Ads",
  purpose: "Paid search spend and conversions",
  status: "connected",
  statusNote: "Credential stored and active",
  lastSyncedAt: "2026-09-14T06:00:00.000Z",
  targetAccount: "123-450-0001",
  testable: true,
};

function card(overrides: Partial<DataSourceCard> = {}): DataSourceCard {
  return { ...healthy, ...overrides };
}

function metaCredential(daysRemaining: number): DataSourceCard["credential"] {
  return {
    kind: "long-lived-access-token",
    state: "active",
    daysRemaining,
    expiresAt: "2026-09-22T07:33:38.000Z",
  };
}

function render(
  source: DataSourceCard,
  options: {
    testState?: ConnectionTestState;
    verifiedSourceId?: string | null;
    canManage?: boolean;
  } = {},
): string {
  return renderToStaticMarkup(
    createElement(ConnectorConsole, {
      activeSources: [source],
      plannedSources: [],
      canManage: options.canManage ?? true,
      disconnectPendingId: null,
      loadingById: {},
      testResults: options.testState ? { [source.id]: options.testState } : {},
      timeZone: "Europe/London",
      verifiedSourceId: options.verifiedSourceId ?? null,
      onAuthorize: () => {},
      onCancelDisconnect: () => {},
      onConfirmDisconnect: () => {},
      onRequestDisconnect: () => {},
      onTest: () => {},
    }),
  );
}

test("a healthy connector surfaces only Test connection and Manage", () => {
  const markup = render(card());

  assert.match(markup, /Test connection/);
  assert.match(markup, /Manage/);
  // The row no longer carries a standing recovery button next to the green
  // chip: that is the confusion this redesign removes.
  assert.doesNotMatch(markup, /Re-authorize now/);
  assert.doesNotMatch(markup, /Renew access/);
  // Disconnect moves into the tray, so the closed row is not three buttons.
  assert.doesNotMatch(markup, />Disconnect</);
});

test("the Manage trigger is a closed menu button before it is opened", () => {
  const markup = render(card());

  assert.match(markup, /aria-haspopup="menu"/);
  assert.match(markup, /aria-expanded="false"/);
  assert.match(markup, /aria-label="More actions for Google Ads"/);
  // Nothing is announced as controlled while the tray is closed.
  assert.doesNotMatch(markup, /aria-controls/);
  assert.doesNotMatch(markup, /role="menu"/);
});

test("a credential inside its final week asks to renew, not to re-authorize", () => {
  const source = card({
    id: "meta-ads",
    name: "Meta Ads",
    credential: metaCredential(3),
  });

  assert.equal(resolveConnectorAuthorizationState(source), "expiring-soon");
  assert.deepEqual(connectorChipPresentation(source, "expiring-soon"), {
    label: "Expiring in 3d",
    modifier: "expiring",
  });

  const markup = render(source);
  assert.match(markup, /Renew access/);
  assert.match(markup, /signal-chip--expiring/);
  // Amber, not the failure colour: the credential still works today.
  assert.doesNotMatch(markup, /signal-chip--error/);
  // The everyday action steps back into the tray so the surface stays at two.
  assert.doesNotMatch(markup, /console-button--quiet"[^>]*>Test connection/);
});

test("the warning window matches the one the token store enforces", async () => {
  const storage = await readFile(
    new URL("../src/lib/connectors/token-storage.ts", import.meta.url),
    "utf8",
  );
  const declared = storage.match(
    /TOKEN_EXPIRY_WARNING_DAYS\s*=\s*(\d+)/,
  )?.[1];

  assert.equal(Number(declared), CREDENTIAL_EXPIRY_WARNING_DAYS);
});

test("a day outside the warning window stays healthy", () => {
  const source = card({
    id: "meta-ads",
    credential: metaCredential(CREDENTIAL_EXPIRY_WARNING_DAYS + 1),
  });

  assert.equal(resolveConnectorAuthorizationState(source), "healthy");
  assert.match(render(source), /Test connection/);
});

test("an expired credential gets a primary re-authenticate call to action", () => {
  const source = card({
    id: "meta-ads",
    name: "Meta Ads",
    status: "error",
    statusNote: "Long-lived access token expired",
    credential: {
      kind: "long-lived-access-token",
      state: "expired",
      daysRemaining: 0,
      expiresAt: "2026-09-01T00:00:00.000Z",
    },
  });

  assert.equal(resolveConnectorAuthorizationState(source), "reauth-required");

  const markup = render(source);
  assert.match(markup, /console-button--primary/);
  // An expired long-lived token is re-authenticated, not re-authorized.
  assert.match(markup, /Re-authenticate now/);
  assert.match(markup, /Re-auth required/);
});

test("a failed connection test pulls recovery back onto the surface", () => {
  const markup = render(card(), {
    testState: { status: "error", message: "Google Ads rejected the token." },
  });

  assert.equal(
    resolveConnectorAuthorizationState(card(), {
      status: "error",
      message: "Google Ads rejected the token.",
    }),
    "reauth-required",
  );
  assert.match(markup, /Re-authorize now/);
});

test("a deployment misconfiguration is never answered with re-authorize", () => {
  // The page notice for this failure says "Re-authorizing will not help", so a
  // Re-authorize CTA in the row would contradict the sentence above it.
  const source = card({
    status: "error",
    statusNote: "Deployment configuration required",
    recovery: "contact-owner",
  });

  assert.equal(
    resolveConnectorAuthorizationState(source),
    "configuration-blocked",
  );

  const markup = render(source);
  assert.match(markup, /View setup requirements/);
  assert.doesNotMatch(markup, /Re-authorize now/);
  assert.doesNotMatch(markup, /console-button--primary/);
  assert.match(markup, /Config required/);
  assert.doesNotMatch(markup, /More actions/);
  assert.match(render(source, { canManage: false }), /View setup requirements/);
  assert.doesNotMatch(render(source, { verifiedSourceId: source.id }), /Verified/);
});

test("the post-OAuth row confirms before it settles", () => {
  const markup = render(card(), { verifiedSourceId: "google-ads" });

  assert.match(markup, /Verified/);
  assert.match(markup, /role="status"/);
  // The confirmation stands in for the action rather than joining it.
  assert.doesNotMatch(markup, /Test connection/);

  // A different connector's redirect must not confirm this row.
  assert.doesNotMatch(
    render(card(), { verifiedSourceId: "meta-ads" }),
    /Verified/,
  );
});

test("a viewer without manage rights gets no action controls at all", () => {
  const markup = render(card(), { canManage: false });

  assert.match(markup, /Editor access required/);
  assert.doesNotMatch(markup, /aria-haspopup="menu"/);
  assert.doesNotMatch(markup, /Test connection/);
});

test("a disconnected connector still offers the plain connect action", () => {
  const markup = render(
    card({ status: "disconnected", statusNote: "No active credential" }),
  );

  assert.match(markup, /Connect OAuth/);
  assert.match(markup, /connector-oauth-hint-google-ads/);
  assert.doesNotMatch(markup, /aria-haspopup="menu"/);
});

test("the tray holds exactly what the surface does not", () => {
  // Healthy: Test connection is on the surface, so the tray must not repeat it.
  assert.deepEqual(resolveManageActionIds(card(), "healthy"), [
    "reauthorize",
    "disconnect",
  ]);

  // Recovery states promote the recovery button and demote Test connection,
  // so the action stays reachable rather than disappearing.
  for (const state of [
    "expiring-soon",
    "reauth-required",
  ] as const) {
    assert.deepEqual(
      resolveManageActionIds(card(), state),
      ["test", "reauthorize", "disconnect"],
      `tray for ${state}`,
    );
  }
  assert.deepEqual(resolveManageActionIds(card(), "configuration-blocked"), []);

  // A connector with no test endpoint never offers one, in either place.
  assert.deepEqual(
    resolveManageActionIds(card({ testable: false }), "reauth-required"),
    ["reauthorize", "disconnect"],
  );
});

test("the overflow tray is a row-level strip, not a clipped floating panel", async () => {
  const styles = await readFile(
    new URL("../src/app/globals.css", import.meta.url),
    "utf8",
  );

  // `.integration-group` clips overflow to keep its rounded corners, so an
  // absolutely positioned tray would be cut off on a group's last row.
  const groupRule =
    styles.match(/\.integration-group,[^{]*\{[^}]*\}/)?.[0] ?? "";
  assert.match(groupRule, /overflow: hidden/);

  const trayRule =
    styles.match(/\.connector-manage__tray \{[^}]*\}/)?.[0] ?? "";
  assert.match(trayRule, /grid-column: 1 \/ -1/);
  assert.doesNotMatch(trayRule, /position: absolute/);
});
