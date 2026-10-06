import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { hasPermission } from "../src/lib/auth/authorization";
import { getAuthConfiguration } from "../src/lib/auth/auth-config";
import {
  isAllowedOrigin,
  safeInternalPath,
} from "../src/lib/auth/http";
import { resolvePreviewRole } from "../src/lib/auth/session";

test("local development defaults to preview auth", () => {
  const configuration = getAuthConfiguration({ NODE_ENV: "development" });

  assert.equal(configuration.mode, "preview");
  assert.equal(configuration.ready, true);
});

test("Vercel preview defaults to preview auth even with a production build", () => {
  const configuration = getAuthConfiguration({
    NODE_ENV: "production",
    VERCEL_ENV: "preview",
  });

  assert.equal(configuration.isProduction, false);
  assert.equal(configuration.mode, "preview");
  assert.equal(configuration.ready, true);
});

test("production defaults to preview when Supabase is not configured", () => {
  const configuration = getAuthConfiguration({
    NODE_ENV: "production",
  });

  assert.equal(configuration.mode, "preview");
  assert.equal(configuration.ready, true);
});

test("production fails closed when Supabase is explicitly configured but not ready", () => {
  const configuration = getAuthConfiguration({
    DASHBOARD_AUTH_MODE: "supabase",
    NODE_ENV: "production",
  });

  assert.equal(configuration.mode, "supabase");
  assert.equal(configuration.ready, false);
  assert.match(configuration.safeMessage, /not configured/i);
});

test("preview auth can be enabled in production / review deployment", () => {
  const configuration = getAuthConfiguration({
    DASHBOARD_AUTH_MODE: "preview",
    VERCEL_ENV: "production",
  });

  assert.equal(configuration.mode, "preview");
  assert.equal(configuration.ready, true);
});

test("production Supabase auth requires an explicit callback site URL", () => {
  const configuration = getAuthConfiguration({
    DASHBOARD_AUTH_MODE: "supabase",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-test-value",
    NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
    NODE_ENV: "production",
  });

  assert.equal(configuration.ready, false);
  assert.match(configuration.safeMessage, /site URL/i);
});

test("production Supabase auth automatically resolves Vercel production URL fallback", () => {
  const configuration = getAuthConfiguration({
    DASHBOARD_AUTH_MODE: "supabase",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-test-value",
    NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
    VERCEL_PROJECT_PRODUCTION_URL: "satulayar-dashboard.vercel.app",
    NODE_ENV: "production",
    VERCEL_ENV: "production",
  });

  assert.equal(configuration.ready, true);
  assert.equal(
    configuration.siteUrl,
    "https://satulayar-dashboard.vercel.app",
  );
});

test("role permissions separate admin, editor, and view-only access", () => {
  assert.equal(hasPermission("viewer", "dashboard:read"), true);
  assert.equal(hasPermission("viewer", "sync:trigger"), false);
  assert.equal(hasPermission("viewer", "access:manage"), false);
  assert.equal(hasPermission("internal_editor", "sync:trigger"), true);
  assert.equal(hasPermission("internal_editor", "access:manage"), false);
  assert.equal(hasPermission("admin", "sync:trigger"), true);
  assert.equal(hasPermission("admin", "access:manage"), true);
});

test("local preview role supports all levels and rejects unknown values", () => {
  assert.equal(resolvePreviewRole("admin"), "admin");
  assert.equal(resolvePreviewRole("viewer"), "viewer");
  assert.equal(resolvePreviewRole("internal_editor"), "internal_editor");
  assert.equal(resolvePreviewRole("owner"), "internal_editor");
});

test("origin and redirect validation reject lookalikes and protocol-relative paths", () => {
  assert.equal(
    isAllowedOrigin("https://dashboard.example.com", [
      "https://dashboard.example.com/path",
    ]),
    true,
  );
  assert.equal(
    isAllowedOrigin("https://dashboard.example.com.attacker.test", [
      "https://dashboard.example.com",
    ]),
    false,
  );
  assert.equal(safeInternalPath("//attacker.test", "/safe"), "/safe");
  assert.equal(safeInternalPath("/\\attacker.test", "/safe"), "/safe");
  assert.equal(safeInternalPath("/dashboard?range=7d"), "/dashboard?range=7d");
});

test("RLS migration covers every client-data table and removes anonymous grants", async () => {
  const migration = await readFile(
    new URL(
      "../supabase/migrations/0002_auth_membership_rls.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const protectedTables = [
    "clients",
    "ad_accounts",
    "connector_configs",
    "daily_metrics",
    "sync_jobs",
    "sync_job_events",
    "worklog_documents",
    "worklog_entries",
    "generated_summaries",
    "data_quality_issues",
  ];

  for (const table of protectedTables) {
    assert.match(migration, new RegExp(`on public\\.${table} for select`));
    assert.match(
      migration,
      new RegExp(`revoke all on table public\\.${table} from anon`),
    );
  }

  assert.match(
    migration,
    /create type public\.app_role as enum \('admin', 'internal_editor', 'viewer'\)/,
  );
  assert.match(migration, /create policy client_memberships_insert_admin/);
  assert.match(migration, /create policy client_memberships_update_admin/);
  assert.match(migration, /create policy client_memberships_delete_admin/);
  assert.match(
    migration,
    /grant select, insert, update, delete on table public\.client_memberships/,
  );
});

test("dummy persistence keeps the worker secret server-only and live sync fail-closed", async () => {
  const serverSource = await readFile(
    new URL("../src/lib/supabase/server.ts", import.meta.url),
    "utf8",
  );
  const syncRouteSource = await readFile(
    new URL("../src/app/api/sync-jobs/route.ts", import.meta.url),
    "utf8",
  );
  const environmentTemplate = await readFile(
    new URL("../.env.example", import.meta.url),
    "utf8",
  );

  assert.match(serverSource, /process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(serverSource, /NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(serverSource, /persistSession: false/);
  assert.match(syncRouteSource, /configuration\.mode === "live"/);
  // Live mode is no longer blocked by a hardcoded 503. It is gated on the
  // credential and mapping gate instead, and that gate must still be consulted
  // before persistLiveSync is ever reached.
  assert.match(syncRouteSource, /resolveLiveSyncGate\(\)/);
  assert.match(syncRouteSource, /if \(!gate\.unlocked\)/);
  assert.match(syncRouteSource, /status: 503/);
  const gateIndex = syncRouteSource.indexOf("resolveLiveSyncGate()");
  const persistIndex = syncRouteSource.indexOf("await persistLiveSync(");
  assert.ok(gateIndex > -1 && persistIndex > gateIndex, "the gate must be evaluated before any live pull");
  assert.match(environmentTemplate, /DASHBOARD_DATA_STORE=fixture/);
});
