import assert from "node:assert/strict";
import test from "node:test";

import { GoogleAdsApiClient } from "@/lib/connectors/google-ads-api-client";
import { MetaAdsApiClient } from "@/lib/connectors/meta-ads-api-client";
import { SyncPipeline } from "@/lib/connectors/sync-pipeline";
import { NextRequest } from "next/server";
import { POST as saveCredentials } from "@/app/api/connectors/credentials/route";
import { validatePlatformCredentials } from "@/lib/connectors/types";
import { persistGa4Sync } from "@/lib/connectors/ga4-sync";
import { POST as startGoogleConsent } from "@/app/api/connectors/oauth/[platform]/authorize/route";
import { GET as googleCallback } from "@/app/api/connectors/oauth/[platform]/callback/route";
import { sealOAuthSession, openOAuthSession, validateCSRFState, type PopupOAuthSession } from "@/lib/connectors/oauth";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { ConnectorConnectionProgress, metaExpiryDateToIso, PLATFORM_CREDENTIAL_FIELDS } from "@/components/dashboard/connector-credentials-modal";

const META_FORM = { platform: "meta-ads", clientSlug: "kopi-senja", customerId: "act_123456789012345", accessToken: "test-meta-secret", apiVersion: "v23.0", tokenExpiresAt: "2099-01-01T00:00:00Z", campaignNameFilter: "Senja" };
const GA4_FORM = { platform: "google-analytics", clientSlug: "kopi-senja", propertyId: "987654321", clientId: "test-client", clientSecret: "test-client-secret", refreshToken: "test-refresh-secret" };

test("Meta expiry uses a calendar date and converts local midnight without extending token life", () => {
  assert.equal(PLATFORM_CREDENTIAL_FIELDS["meta-ads"].find((field) => field.name === "tokenExpiresAt")?.type, "date");
  const date = new Date(metaExpiryDateToIso("2099-01-02")!);
  assert.equal(date.getFullYear(), 2099);
  assert.equal(date.getMonth(), 0);
  assert.equal(date.getDate(), 2);
  assert.equal(date.getHours(), 0);
  assert.equal(date.getMinutes(), 0);
  assert.equal(metaExpiryDateToIso("2099-02-30"), null);
  assert.equal(metaExpiryDateToIso("2099-01-02T00:00:00Z"), null);
  assert.equal(metaExpiryDateToIso(""), null);
});

function credentialRequest(body: unknown, origin = "http://localhost:3000") {
  return new NextRequest("http://localhost:3000/api/connectors/credentials", { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

async function withPlatformStorage(run: (calls: { url: string; method: string; body: string; headers: Headers }[]) => Promise<void>, providerFailure = false, storageFailure = false, storedGrant?: Record<string, unknown>, oauthGrant?: Record<string, unknown>) {
  const keys = ["DASHBOARD_AUTH_MODE", "DASHBOARD_PREVIEW_ROLE", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;
  const before = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const original = globalThis.fetch;
  const calls: { url: string; method: string; body: string; headers: Headers }[] = [];
  Object.assign(process.env, { DASHBOARD_AUTH_MODE: "preview", DASHBOARD_PREVIEW_ROLE: "internal_editor", NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test-service-role" });
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const call = { url: request.url, method: request.method, body: request.method === "GET" ? "" : await request.text(), headers: request.headers };
    calls.push(call);
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
    if (request.url.includes("project.supabase.co")) {
      if (request.method === "GET") return json(storedGrant && new URL(request.url).searchParams.get("select")?.includes("access_token") ? storedGrant : []);
      if (request.url.includes("activity_audit_log")) return json({ id: "test-audit" });
      if (storageFailure) return json({ message: "storage unavailable" }, 503);
      const row = JSON.parse(call.body);
      return json({ id: "test-row", created_at: "2026-10-15T00:00:00Z", ...row });
    }
    if (providerFailure) return json({ error: "test-meta-secret test-refresh-secret test-client-secret" }, 403);
    if (request.url.startsWith("https://graph.facebook.com/")) return json(request.url.includes("/insights") ? { data: [] } : { id: META_FORM.customerId, currency: "USD" });
    if (request.url === "https://oauth2.googleapis.com/token") return json(new URLSearchParams(call.body).get("grant_type") === "authorization_code" ? oauthGrant ?? { access_token: "test-short-access", refresh_token: "test-refresh-secret", scope: "https://www.googleapis.com/auth/analytics.readonly" } : { access_token: "test-short-access" });
    if (request.url.startsWith("https://analyticsdata.googleapis.com/")) return json({ rows: [], metadata: { timeZone: "Asia/Jakarta" } });
    throw new Error("Unexpected endpoint in offline test");
  };
  try { await run(calls); } finally {
    globalThis.fetch = original;
    for (const key of keys) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
  }
}

const GA4_CONTEXT = { params: Promise.resolve({ platform: "google-analytics" }) };
function popupRequest(path: string, cookies: { name: string; value: string }[]) {
  return new NextRequest(`http://localhost:3000${path}`, { headers: { cookie: cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ") } });
}

test("Google popup exchanges consent, verifies reporting, then returns only a brand-bound safe result", async () => {
  await withPlatformStorage(async (calls) => {
    const start = await startGoogleConsent(credentialRequest({ ...GA4_FORM, refreshToken: undefined }), GA4_CONTEXT);
    assert.equal(start.status, 200);
    const bootstrap = await start.json();
    const url = new URL(bootstrap.authorizationUrl);
    assert.equal(url.origin, "https://accounts.google.com");
    assert.equal(url.searchParams.get("prompt"), "select_account consent");
    assert.equal(url.searchParams.get("access_type"), "offline");
    assert.equal(url.searchParams.get("scope"), "https://www.googleapis.com/auth/analytics.readonly");
    assert.ok(!bootstrap.authorizationUrl.includes(GA4_FORM.clientSecret));
    assert.ok(!calls.some((call) => call.method === "POST"));
    const cookies = start.cookies.getAll();
    const sealed = cookies.find((cookie) => cookie.name === "oauth_popup_google-analytics")!;
    assert.ok(sealed.httpOnly);
    assert.ok(!sealed.value.includes(GA4_FORM.clientSecret));
    const complete = await googleCallback(popupRequest(`/api/connectors/oauth/google-analytics/callback?code=test-code&state=${encodeURIComponent(bootstrap.attempt)}`, cookies), GA4_CONTEXT);
    const html = await complete.text();
    assert.match(html, /Connected successfully/);
    assert.match(html, /setTimeout\(\(\)=>window.close\(\),1600\)/);
    assert.doesNotMatch(html, /test-client-secret|test-refresh-secret|test-short-access/);
    assert.ok(calls.some((call) => call.url.includes("analyticsdata.googleapis.com")));
    assert.ok(calls.some((call) => call.method === "POST" && call.url.includes("connector_tokens")));
    const resultCookies = complete.cookies.getAll();
    const result = await googleCallback(popupRequest(`/api/connectors/oauth/google-analytics/callback?connection_result=${encodeURIComponent(bootstrap.attempt)}&client=kopi-senja`, resultCookies), GA4_CONTEXT);
    const summary = await result.json();
    assert.equal(summary.ok, true);
    assert.equal(summary.clientSlug, "kopi-senja");
    assert.equal(summary.platform, "google-analytics");
    assert.doesNotMatch(JSON.stringify(summary), /test-client-secret|test-refresh-secret|test-short-access/);
    const wrongAttempt = await googleCallback(popupRequest("/api/connectors/oauth/google-analytics/callback?connection_result=forged&client=kopi-senja", resultCookies), GA4_CONTEXT);
    assert.equal(wrongAttempt.status, 202);
    const wrongBrand = await googleCallback(popupRequest(`/api/connectors/oauth/google-analytics/callback?connection_result=${encodeURIComponent(bootstrap.attempt)}&client=batik-lestari`, resultCookies), GA4_CONTEXT);
    assert.equal(wrongBrand.status, 202);
  });
});

test("Google popup denial, state mismatch and provider failure never replace the working credential", async () => {
  for (const mode of ["denied", "mismatch", "provider"] as const) await withPlatformStorage(async (calls) => {
    const start = await startGoogleConsent(credentialRequest(GA4_FORM), GA4_CONTEXT);
    const bootstrap = await start.json();
    const query = mode === "denied" ? `error=access_denied&state=${encodeURIComponent(bootstrap.attempt)}` : `code=test-code&state=${encodeURIComponent(mode === "mismatch" ? "forged" : bootstrap.attempt)}`;
    const complete = await googleCallback(popupRequest(`/api/connectors/oauth/google-analytics/callback?${query}`, start.cookies.getAll()), GA4_CONTEXT);
    const html = await complete.text();
    assert.match(html, /Connection not completed/);
    assert.doesNotMatch(html, /setTimeout\(\(\)=>window.close|test-client-secret|test-refresh-secret/);
    assert.ok(!calls.some((call) => call.method === "POST" && call.url.includes("connector_tokens")));
    if (mode !== "provider") assert.ok(!calls.some((call) => call.url.includes("googleapis.com")));
  }, mode === "provider");
});

test("Google popup bootstrap requires an editor, same origin and matching client pair", async () => {
  await withPlatformStorage(async (calls) => {
    process.env.DASHBOARD_PREVIEW_ROLE = "viewer";
    assert.equal((await startGoogleConsent(credentialRequest(GA4_FORM), GA4_CONTEXT)).status, 403);
    process.env.DASHBOARD_PREVIEW_ROLE = "internal_editor";
    assert.equal((await startGoogleConsent(credentialRequest(GA4_FORM, "https://untrusted.example"), GA4_CONTEXT)).status, 403);
    assert.equal(calls.length, 0);
    const missingPair = await startGoogleConsent(credentialRequest({ ...GA4_FORM, clientSecret: "" }), GA4_CONTEXT);
    assert.equal(missingPair.status, 400);
    assert.equal((await missingPair.json()).field, "clientSecret");
    assert.ok(!calls.some((call) => call.url.includes("googleapis.com")));
  });
});

test("incomplete Google consent and a failed save never produce popup success", async () => {
  for (const mode of ["refresh", "scope", "storage"] as const) await withPlatformStorage(async (calls) => {
    const start = await startGoogleConsent(credentialRequest(GA4_FORM), GA4_CONTEXT);
    const bootstrap = await start.json();
    const complete = await googleCallback(popupRequest(`/api/connectors/oauth/google-analytics/callback?code=test-code&state=${encodeURIComponent(bootstrap.attempt)}`, start.cookies.getAll()), GA4_CONTEXT);
    const html = await complete.text();
    assert.match(html, /Connection not completed/);
    assert.doesNotMatch(html, /Connected successfully|test-short-access|test-refresh-secret/);
    if (mode !== "storage") assert.ok(!calls.some((call) => call.method === "POST" && call.url.includes("connector_tokens")));
  }, false, mode === "storage", undefined, mode === "refresh" ? { access_token: "test-short-access" } : mode === "scope" ? { access_token: "test-short-access", refresh_token: "test-refresh-secret", scope: "openid" } : undefined);
});

test("Google Ads requests its own permission and GA4 reuses a saved client pair without exposing it", async () => {
  await withPlatformStorage(async () => {
    const response = await startGoogleConsent(credentialRequest({ clientSlug: "kopi-senja", customerId: "123-450-0001", developerToken: "test-developer", clientId: "test-client", clientSecret: "test-secret" }), { params: Promise.resolve({ platform: "google-ads" }) });
    assert.equal(response.status, 200);
    assert.equal(new URL((await response.json()).authorizationUrl).searchParams.get("scope"), "https://www.googleapis.com/auth/adwords");
  });
  await withPlatformStorage(async () => {
    const response = await startGoogleConsent(credentialRequest({ clientSlug: "kopi-senja" }), GA4_CONTEXT);
    assert.equal(response.status, 200);
    const json = await response.text();
    assert.doesNotMatch(json, /test-client-secret|test-refresh-secret/);
    const pending = openOAuthSession<PopupOAuthSession>(response.cookies.get("oauth_popup_google-analytics")?.value)!;
    assert.equal(pending.fields.propertyId, GA4_FORM.propertyId);
    assert.equal(pending.fields.clientId, GA4_FORM.clientId);
    assert.equal(pending.fields.clientSecret, GA4_FORM.clientSecret);
    const partial = await startGoogleConsent(credentialRequest({ clientSlug: "kopi-senja", clientId: "different-client" }), GA4_CONTEXT);
    assert.equal(partial.status, 400);
  }, false, false, { id: "saved-grant", platform: "google-analytics", client_slug: "kopi-senja", customer_id: GA4_FORM.propertyId, refresh_token: GA4_FORM.refreshToken, status: "active", metadata: { configuredVia: "direct_platform_form", clientId: GA4_FORM.clientId, clientSecret: GA4_FORM.clientSecret } });
});

test("popup sessions reject tampering, stale timestamps and future CSRF states", async () => {
  await withPlatformStorage(async () => {
    const pending: PopupOAuthSession = { state: "test-state", clientSlug: "kopi-senja", platform: "google-analytics", userId: "test-user", createdAt: Date.now(), fields: { clientSecret: "test-secret" } };
    const sealed = sealOAuthSession(pending);
    assert.deepEqual(openOAuthSession(sealed), pending);
    assert.equal(openOAuthSession(sealed.slice(0, -12) + "tampered"), null);
    assert.equal(openOAuthSession(sealOAuthSession({ ...pending, createdAt: Date.now() - 900_001 })), null);
    const future = `google-analytics:${Date.now() + 60_000}:random`;
    assert.equal(validateCSRFState("google-analytics", future, future), false);
  });
});

test("all active platforms share a named connection progress, failure and success surface", () => {
  for (const platform of ["google-ads", "meta-ads", "google-analytics"] as const) {
    for (const stage of ["authorizing", "verifying", "success", "error"] as const) {
      const html = renderToStaticMarkup(createElement(ConnectorConnectionProgress, { platform, stage, error: "Try again safely.", onClose() {}, onRetry() {} }));
      assert.match(html, /Connection steps/);
      assert.match(html, /aria-live="polite"/);
      assert.match(html, stage === "success" ? /Connected successfully/ : stage === "error" ? /Connection not completed/ : /aria-busy="true"/);
    }
  }
});

test("platform forms reject path injection, expired Meta tokens and GA4 measurement IDs", () => {
  assert.equal(validatePlatformCredentials("meta-ads", { ...META_FORM, customerId: "../me" })?.field, "customerId");
  assert.equal(validatePlatformCredentials("meta-ads", { ...META_FORM, apiVersion: "https://elsewhere.example" })?.field, "apiVersion");
  assert.equal(validatePlatformCredentials("meta-ads", { ...META_FORM, tokenExpiresAt: "2000-01-01" })?.field, "tokenExpiresAt");
  assert.equal(validatePlatformCredentials("meta-ads", { ...META_FORM, tokenExpiresAt: "2099-01-01T00:00:00" })?.field, "tokenExpiresAt");
  assert.equal(validatePlatformCredentials("meta-ads", { ...META_FORM, campaignNameFilter: 123 })?.field, "campaignNameFilter");
  assert.equal(validatePlatformCredentials("google-analytics", { ...GA4_FORM, propertyId: "G-ABC" })?.field, "propertyId");
});

test("Meta form verifies read-only API access before persisting the brand configuration", async () => {
  await withPlatformStorage(async (calls) => {
    const response = await saveCredentials(credentialRequest(META_FORM));
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.doesNotMatch(body, /test-meta-secret|test-service-role/);
    const provider = calls.filter((call) => call.url.startsWith("https://graph.facebook.com/"));
    assert.equal(provider.length, 2);
    assert.ok(provider.every((call) => call.method === "GET" && !call.url.includes(META_FORM.accessToken)));
    assert.equal(provider[0].headers.get("authorization"), `Bearer ${META_FORM.accessToken}`);
    const writeIndex = calls.findIndex((call) => call.method === "POST" && call.url.includes("connector_tokens"));
    assert.ok(writeIndex > calls.indexOf(provider[1]));
    const saved = JSON.parse(calls[writeIndex].body);
    assert.equal(saved.customer_id, "123456789012345");
    assert.equal(saved.client_slug, META_FORM.clientSlug);
    assert.equal(saved.metadata.campaignFilter, "Senja");
    assert.equal(saved.metadata.apiVersion, META_FORM.apiVersion);
  });
});

test("GA4 form stores the matching OAuth client and property after a successful report probe", async () => {
  await withPlatformStorage(async (calls) => {
    const response = await saveCredentials(credentialRequest(GA4_FORM));
    assert.equal(response.status, 200);
    assert.doesNotMatch(await response.text(), /test-refresh-secret|test-client-secret|test-short-access/);
    const exchange = calls.find((call) => call.url === "https://oauth2.googleapis.com/token")!;
    assert.equal(new URLSearchParams(exchange.body).get("client_id"), GA4_FORM.clientId);
    const report = calls.find((call) => call.url.includes("analyticsdata.googleapis.com"))!;
    assert.match(report.url, /properties\/987654321:runReport$/);
    assert.equal(report.headers.get("authorization"), "Bearer test-short-access");
    const saved = JSON.parse(calls.find((call) => call.method === "POST" && call.url.includes("connector_tokens"))!.body);
    assert.equal(saved.customer_id, GA4_FORM.propertyId);
    assert.equal(saved.metadata.clientSecret, GA4_FORM.clientSecret);
    assert.equal(saved.refresh_token, GA4_FORM.refreshToken);
  });
});

test("provider rejection never stores a credential or echoes submitted secrets", async () => {
  for (const form of [META_FORM, GA4_FORM]) await withPlatformStorage(async (calls) => {
    const response = await saveCredentials(credentialRequest(form));
    assert.ok(response.status >= 400);
    assert.doesNotMatch(await response.text(), /test-meta-secret|test-refresh-secret|test-client-secret/);
    assert.ok(!calls.some((call) => call.method === "POST" && call.url.includes("connector_tokens")));
  }, true);
});

test("viewer and cross-origin attempts cannot reach credential verification", async () => {
  await withPlatformStorage(async (calls) => {
    process.env.DASHBOARD_PREVIEW_ROLE = "viewer";
    assert.equal((await saveCredentials(credentialRequest(META_FORM))).status, 403);
    process.env.DASHBOARD_PREVIEW_ROLE = "internal_editor";
    assert.equal((await saveCredentials(credentialRequest(GA4_FORM, "https://untrusted.example"))).status, 403);
    assert.equal(calls.length, 0);
  });
});

test("verified API access with failed storage is not reported as connected", async () => {
  await withPlatformStorage(async () => {
    const response = await saveCredentials(credentialRequest(META_FORM));
    assert.equal(response.status, 503);
    assert.equal((await response.json()).ok, undefined);
  }, false, true);
});

test("GA4 sync consumes the form's stored property and matching OAuth pair", async () => {
  const storedGrant = { id: "test-ga4", platform: "google-analytics", client_slug: "kopi-senja", customer_id: GA4_FORM.propertyId, access_token: "", refresh_token: GA4_FORM.refreshToken, status: "active", expires_at: null, metadata: { configuredVia: "direct_platform_form", clientId: GA4_FORM.clientId, clientSecret: GA4_FORM.clientSecret } };
  await withPlatformStorage(async (calls) => {
    const result = await persistGa4Sync({ clientId: "test-brand", clientSlug: "kopi-senja", range: { start: "2026-10-01", end: "2026-10-02" }, currency: "USD" });
    assert.equal(result.outcome, "succeeded");
    const exchange = calls.find((call) => call.url === "https://oauth2.googleapis.com/token")!;
    assert.equal(new URLSearchParams(exchange.body).get("client_id"), GA4_FORM.clientId);
    assert.equal(new URLSearchParams(exchange.body).get("client_secret"), GA4_FORM.clientSecret);
    const reports = calls.filter((call) => call.url.includes("analyticsdata.googleapis.com"));
    assert.ok(reports.length > 0);
    assert.ok(reports.every((call) => call.url.endsWith(`/properties/${GA4_FORM.propertyId}:runReport`)));
  }, false, false, storedGrant);
});

test("GoogleAdsApiClient reports unauthenticated when credentials are missing", async () => {
  const client = new GoogleAdsApiClient({});
  const health = await client.health();
  assert.equal(health.available, false);
  assert.equal(health.authenticated, false);
  assert.equal(health.readOnly, true);
});

test("MetaAdsApiClient reports unauthenticated when credentials are missing", async () => {
  const client = new MetaAdsApiClient({});
  const health = await client.health();
  assert.equal(health.available, false);
  assert.equal(health.authenticated, false);
  assert.equal(health.readOnly, true);
});

test("SyncPipeline fails closed in live mode when direct API is unconfigured", async () => {
  const pipeline = new SyncPipeline();
  const result = await pipeline.runSync({
    clientId: "pilot-client",
    accountKey: "kopi-senja-usd",
    range: { start: "2026-08-01", end: "2026-08-07" },
    platforms: ["meta", "google"],
    mode: "live",
  });

  assert.equal(result.status, "failed");
  assert.equal(result.dataStatus, "blocked");
  assert.equal(result.recordsProcessed, 0);
  assert.ok(result.errors.length > 0);
});

test("SyncPipeline succeeds in mock mode", async () => {
  const pipeline = new SyncPipeline();
  const result = await pipeline.runSync({
    clientId: "pilot-client",
    accountKey: "kopi-senja-usd",
    range: { start: "2026-08-01", end: "2026-08-07" },
    platforms: ["meta", "google"],
    mode: "mock",
  });

  assert.equal(result.status, "succeeded");
  assert.equal(result.dataStatus, "ready");
  assert.ok(result.recordsProcessed > 0);
  assert.ok(result.rows.length > 0);
});
