import assert from "node:assert/strict";
import test from "node:test";

import { NAV_GROUPS } from "../src/components/dashboard/sidebar-nav";
import { buildDashboardSnapshot } from "../src/lib/dashboard/fixtures";
import {
  anchorSectionId,
  GOOGLE_ONLY_SECTIONS,
  META_ONLY_SECTIONS,
  isSectionVisible,
} from "../src/lib/dashboard/sections";

const RANGE = { start: "2026-07-01", end: "2026-07-14" };

test("Google-only cuts appear on the Google filter and nowhere else", () => {
  for (const section of GOOGLE_ONLY_SECTIONS) {
    assert.equal(isSectionVisible(section, "google"), true, section);
    assert.equal(isSectionVisible(section, "meta"), false, section);
    // The combined view keeps only what genuinely spans both platforms.
    assert.equal(isSectionVisible(section, "all"), false, section);
  }
});

test("Meta-only cuts appear on the Meta filter and nowhere else", () => {
  for (const section of META_ONLY_SECTIONS) {
    assert.equal(isSectionVisible(section, "meta"), true, section);
    assert.equal(isSectionVisible(section, "google"), false, section);
    // Mirrors the Google-only rule: the combined view keeps only what spans
    // both platforms, so a Meta-only cut disappears there too.
    assert.equal(isSectionVisible(section, "all"), false, section);
  }
});

test("the shared sections survive every filter", () => {
  const shared = [
    "budget-pacing",
    "snapshot",
    "platform-performance",
    "performance",
    "journey-metrics",
    "blended-mer",
    "data-health",
  ];

  for (const platform of ["all", "meta", "google"] as const) {
    for (const section of shared) {
      assert.equal(isSectionVisible(section, platform), true, `${section}/${platform}`);
    }
  }
});

test("no nav sub-item survives a filter that hides its section", () => {
  const paidAds = NAV_GROUPS.flatMap((group) => group.sections).find(
    (section) => section.href === "/",
  );
  const anchors = (paidAds?.children ?? [])
    .map((child) => anchorSectionId(child.href))
    .filter((id): id is string => id !== null);

  assert.ok(anchors.length > 0);
  const visibleUnderCombined = anchors.filter((id) =>
    isSectionVisible(id, "all"),
  );

  for (const section of GOOGLE_ONLY_SECTIONS) {
    assert.equal(visibleUnderCombined.includes(section), false, section);
  }
  for (const section of META_ONLY_SECTIONS) {
    assert.equal(visibleUnderCombined.includes(section), false, section);
  }
});

test("a Google filter never surfaces Meta pacing or a hidden section", () => {
  const google = buildDashboardSnapshot(RANGE, "google");

  // Budget pacing is the one that leaked: it used to build both platforms
  // regardless of the filter, so a Google view advised on Meta's budget.
  assert.deepEqual(
    google.budgetPacing.platforms.map((row) => row.platform),
    ["google"],
  );
  assert.deepEqual(
    google.platformBreakdown.map((row) => row.platform),
    ["google"],
  );

  for (const observation of google.advisory.observations) {
    assert.equal(
      /\bMeta\b/.test(observation.headline),
      false,
      `Google view names Meta: ${observation.headline}`,
    );
  }
  for (const action of google.advisory.actions) {
    assert.equal(/\bMeta\b/.test(action.action), false, action.action);
  }
});

test("a Meta filter drops Google-only evidence from the brief", () => {
  const meta = buildDashboardSnapshot(RANGE, "meta");

  assert.deepEqual(
    meta.budgetPacing.platforms.map((row) => row.platform),
    ["meta"],
  );
  // Impression share is identical to Google; it must not be cited under Meta.
  assert.equal(meta.impressionShare, null);
  for (const observation of meta.advisory.observations) {
    assert.notEqual(observation.evidence, "Impression share");
  }
});

test("the combined view does not cite a section it no longer renders", () => {
  const combined = buildDashboardSnapshot(RANGE, "all");

  for (const observation of combined.advisory.observations) {
    assert.equal(
      isSectionVisible(
        observation.evidence === "Impression share"
          ? "impression-share"
          : "journey-metrics",
        "all",
      ),
      true,
      `combined view cites ${observation.evidence}, which is hidden`,
    );
  }
});

test("the daily trend carries registrations alongside orders", () => {
  const snapshot = buildDashboardSnapshot(RANGE, "all");
  const point = snapshot.trend[0];

  assert.ok(point);
  assert.equal(typeof point.registrations, "number");
  // Registrations sit above orders in the funnel, so the day-level series must
  // not be a copy of the purchase series.
  const totalRegistrations = snapshot.trend.reduce(
    (total, item) => total + item.registrations,
    0,
  );
  const totalPurchases = snapshot.trend.reduce(
    (total, item) => total + item.purchases,
    0,
  );
  assert.equal(totalRegistrations, snapshot.totals.registrations);
  assert.ok(totalRegistrations > totalPurchases);
});
