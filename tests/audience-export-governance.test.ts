import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { hasPermission } from "@/lib/auth/authorization";
import { APP_ROLES, DASHBOARD_PERMISSIONS } from "@/lib/auth/types";
import {
  audienceExportFilename,
  parseAudienceExportRequest,
} from "@/lib/dashboard/audience-export-request";
import { buildCommandIndex } from "@/lib/dashboard/command-index";

/**
 * These tests exist because of four findings on the value-based export review
 * (handoff §13). Each one locks a fix that is easy to undo by accident.
 */

// ------------------------------------------------------ S-1: who may export

test("exporting customer identities is its own permission, not a reporting one", () => {
  assert.ok(
    (DASHBOARD_PERMISSIONS as readonly string[]).includes("audience:export"),
    "the permission must exist in the contract, not be implied by another",
  );

  // The two accounts that exist today: the owner is admin, the operator is an
  // internal editor and is the person who actually uploads an audience.
  assert.equal(hasPermission("admin", "audience:export"), true);
  assert.equal(hasPermission("internal_editor", "audience:export"), true);
  // Reading performance does not entitle anyone to the customer base.
  assert.equal(hasPermission("viewer", "audience:export"), false);
});

test("a viewer keeps read access and gains nothing else", () => {
  const viewerPermissions = DASHBOARD_PERMISSIONS.filter((permission) =>
    hasPermission("viewer", permission),
  );

  assert.deepEqual(viewerPermissions, ["dashboard:read"]);
  assert.equal(APP_ROLES.includes("viewer"), true);
});

test("the palette offers an audience export only to roles that hold the permission", () => {
  for (const role of APP_ROLES) {
    const exports = buildCommandIndex({ role, platform: "all" }).filter((entry) =>
      entry.id.startsWith("export:audience"),
    );
    const allowed = hasPermission(role, "audience:export");

    assert.equal(
      exports.length > 0,
      allowed,
      `${role} must ${allowed ? "see" : "not see"} the audience exports`,
    );
  }
});

test("the store export menu is gated in the component, not merely styled away", async () => {
  const shellSource = await readFile(
    new URL("../src/components/store/store-analytics-shell.tsx", import.meta.url),
    "utf8",
  );

  assert.match(shellSource, /hasPermission\(viewer\.role, "audience:export"\)/);
  assert.match(shellSource, /\{canExportAudience && \(/);
});

// -------------------------------------------- S-2: synthetic data marking

test("a file built from synthetic data is named so it cannot be mistaken", () => {
  assert.equal(
    audienceExportFilename({ preset: "meta-value-based" }, "kopi-senja", "2026-09-12", "dummy"),
    "SYNTHETIC-kopi-senja-meta-value-based-2026-09-12.csv",
  );
  assert.equal(
    audienceExportFilename({ preset: "meta-value-based" }, "kopi-senja", "2026-09-12", "live"),
    "kopi-senja-meta-value-based-2026-09-12.csv",
  );
});

test("the store export passes its data mode into the filename", async () => {
  const shellSource = await readFile(
    new URL("../src/components/store/store-analytics-shell.tsx", import.meta.url),
    "utf8",
  );

  assert.match(shellSource, /dataMode=\{snapshot\.mode\}/);
  assert.match(shellSource, /audienceExportFilename\(/);
  // The analytics CSV is not a platform template, so it keeps its own columns
  // and gets the marker directly.
  assert.match(shellSource, /dataMode === "dummy" \? "SYNTHETIC-" : ""/);
});

test("the hero badge tells the truth about live traffic without unmarking the export", async () => {
  const shellSource = await readFile(
    new URL("../src/components/store/store-analytics-shell.tsx", import.meta.url),
    "utf8",
  );

  // Two different questions, two different sources, on purpose. The export
  // marker asks "are these customer rows real?" and reads `snapshot.mode`. The
  // badge asks "did live traffic land?" and reads `modeStatus`. Collapsing them
  // into one field is what would strip SYNTHETIC- off a file of invented rows.
  assert.match(shellSource, /function describeModeBadge\(/);
  assert.match(shellSource, /describeModeBadge\(isDummyMode, modeStatus\)/);
  assert.doesNotMatch(
    shellSource,
    /describeModeBadge\([^)]*snapshot\.mode/,
    "the badge must not be derived from the export provenance field",
  );

  // Three states, not two. The live path fails soft, so live mode alone does
  // not mean live figures: the live label is gated on liveTrafficApplied.
  assert.match(shellSource, /"Simulated dummy data"/);
  assert.match(shellSource, /"Live traffic · Store fixtures"/);
  assert.match(shellSource, /modeStatus\?\.liveTrafficApplied/);

  const dummyLabel = shellSource.indexOf('"Simulated dummy data"');
  const liveGate = shellSource.indexOf("modeStatus?.liveTrafficApplied");
  const liveLabel = shellSource.indexOf('"Live traffic · Store fixtures"');
  assert.ok(
    dummyLabel > -1 && liveGate > dummyLabel && liveLabel > liveGate,
    "the dummy check comes first, then the live-traffic gate, then the live label",
  );

  // A live mode that never hydrated must not borrow the live label.
  assert.match(shellSource, /label: "Store fixtures"/);

  // Hero badge, sidebar gate card and footer read one value, so they cannot
  // contradict each other on screen.
  assert.match(shellSource, /className=\{modeBadge\.className\}/);
  assert.match(shellSource, /<strong>\{modeBadge\.label\}<\/strong>/);
  assert.match(shellSource, /Satulayar store analytics · \{modeBadge\.label\}/);
});

test("the server hands the shell a mode status so the badge is right on first paint", async () => {
  const [page, route] = await Promise.all(
    [
      "../src/app/store-analytics/page.tsx",
      "../src/app/api/store-analytics/route.ts",
    ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
  );

  // Without this the badge could only be honest after the first refetch, and a
  // fresh page load would contradict the toggle sitting next to it.
  assert.match(page, /initialModeStatus=\{initialModeStatus\}/);
  assert.match(page, /liveTrafficApplied,/);
  assert.match(page, /hydration\.summary\.hydrated/);

  // Both producers share one contract rather than each declaring their own.
  for (const source of [page, route]) {
    assert.match(source, /StoreModeStatus/);
    assert.match(source, /from "@\/lib\/store\/types"/);
  }
});

// ------------------------------- S-3 and S-4: one engine, formula guarded

test("the platform exports are built by the shared engine, not a second copy", async () => {
  const shellSource = await readFile(
    new URL("../src/components/store/store-analytics-shell.tsx", import.meta.url),
    "utf8",
  );

  assert.match(shellSource, /buildAudienceExportCsv\(toAudienceRecords\(customers\)/);
  // The component must no longer hand-roll the platform column layouts.
  assert.doesNotMatch(shellSource, /filePrefix: "meta-value-based"/);
  assert.doesNotMatch(shellSource, /filePrefix: "google-customer-match"/);
  // And it must not keep a second, unguarded CSV escape.
  assert.doesNotMatch(shellSource, /function csvCell\(/);
  // The escape now comes from the shared module. Newline style varies by OS,
  // so the match spans whitespace rather than assuming \n.
  assert.match(
    shellSource,
    /csvCell,[\s\S]{0,40}from "@\/lib\/dashboard\/audience-exporter"/,
  );
});

// ---------------------------------------------- request validation surface

test("the export request rejects anything not on a fixed list", () => {
  assert.equal(parseAudienceExportRequest(null).ok, false);
  assert.equal(parseAudienceExportRequest({ preset: "meta" }).ok, false);
  assert.equal(
    parseAudienceExportRequest({ preset: "meta-value-based", segments: "Champions" }).ok,
    false,
  );
  assert.equal(
    parseAudienceExportRequest({ preset: "meta-value-based", segments: ["Everyone"] }).ok,
    false,
  );
  assert.equal(
    parseAudienceExportRequest({ preset: "meta-value-based", hash: "md5" }).ok,
    false,
  );
  // A hashed analytics file cannot be analysed, so the combination is refused.
  assert.equal(
    parseAudienceExportRequest({ preset: "full-cohort-analytics", hash: "sha256" }).ok,
    false,
  );

  const parsed = parseAudienceExportRequest({
    preset: "google-customer-match",
    segments: ["Champions", "At Risk"],
    hash: "sha256",
    account: " kopi-senja ",
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.value.segments, ["Champions", "At Risk"]);
  assert.equal(parsed.value.accountSlug, "kopi-senja");
  assert.equal(parsed.value.hash, "sha256");
  // Both flags default to off: a synthetic export must be asked for explicitly.
  assert.equal(parsed.value.acknowledgeSyntheticData, false);
  assert.equal(parsed.value.preview, false);
});
