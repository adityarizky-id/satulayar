import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { ACCOUNT_OPTIONS } from "@/lib/dashboard/accounts";

/**
 * The account selector used to clip the longer brand names and let them run
 * under the currency chip. These tests lock the three things that made that
 * possible: a hard width cap, a sizer that disagreed with the select, and a
 * blanket topbar padding rule that outranked the account rule.
 */

async function readStyles(): Promise<string> {
  return readFile(new URL("../src/app/globals.css", import.meta.url), "utf8");
}

async function readComponent(): Promise<string> {
  return readFile(
    new URL("../src/components/dashboard/filter-fields.tsx", import.meta.url),
    "utf8",
  );
}

async function readDashboardShell(): Promise<string> {
  return readFile(
    new URL(
      "../src/components/dashboard/dashboard-shell.tsx",
      import.meta.url,
    ),
    "utf8",
  );
}

async function readAppFrame(): Promise<string> {
  return readFile(
    new URL("../src/components/dashboard/app-frame.tsx", import.meta.url),
    "utf8",
  );
}

async function readLineChart(): Promise<string> {
  return readFile(
    new URL("../src/components/charts/line-chart.tsx", import.meta.url),
    "utf8",
  );
}

test("the brand names this control has to fit are longer than the old cap", () => {
  const longest = ACCOUNT_OPTIONS.map((account) => account.name).toSorted(
    (left, right) => right.length - left.length,
  )[0];

  // Roughly 7px per character at the compact 10.5px weight-700 face, plus the
  // 72px reserved for chip and chevron, already exceeds the old 190px cap.
  assert.equal(longest, "Kopi Senja Nusantara");
  assert.ok(longest.length * 7 + 72 > 190);
});

test("the control is sized by the active brand, not by a fixed width", async () => {
  const component = await readComponent();

  assert.match(component, /className="select-wrap__sizer"/);
  assert.match(component, /\{activeAccount\?\.name \?\? value\}/);
  // The sizer must never reach the accessibility tree; the select is the only
  // thing announced or focusable.
  assert.match(component, /aria-hidden="true" className="select-wrap__sizer"/);
});

test("no width cap truncates the account control any more", async () => {
  const styles = await readStyles();
  const capped = [
    ...styles.matchAll(
      /\.topbar__scope \.utility-field--account \{[^}]*\}/g,
    ),
  ].map((match) => match[0]);

  assert.ok(capped.length >= 1, "the account field rule must exist");
  for (const rule of capped) {
    assert.match(rule, /max-width: none/);
    assert.doesNotMatch(rule, /max-width: \d/);
    // A floor is kept so a short name does not collapse the pill into a stub.
    assert.match(rule, /min-width: \d+px/);
  }
});

test("the select and its sizer reserve the same trailing space", async () => {
  const styles = await readStyles();

  assert.match(styles, /--account-trailing-space: 78px/);
  assert.match(styles, /--account-trailing-space: 72px/);
  // One declaration drives both, so they cannot drift apart.
  assert.match(
    styles,
    /\.select-wrap--account select,\s*\n\s*\.select-wrap--account \.select-wrap__sizer \{\s*\n\s*padding-right: var\(--account-trailing-space\);/,
  );
});

test("the blanket topbar padding can no longer bury the brand name", async () => {
  const styles = await readStyles();

  // This is the rule that caused the collision: it outranks the account rule,
  // so the account control needs an override at higher specificity.
  assert.match(styles, /\.topbar \.utility-field select \{[^}]*padding-right: 25px/);
  assert.match(
    styles,
    /\.topbar \.utility-field \.select-wrap--account select \{\s*\n\s*padding-right: var\(--account-trailing-space\);/,
  );
});

test("the sizer stays in flow and keeps the compact metrics of the topbar select", async () => {
  const styles = await readStyles();
  const sizerRule =
    styles
      .match(/\.select-wrap--account \.select-wrap__sizer \{[^}]*\}/g)
      ?.find((rule) => rule.includes("visibility: hidden")) ?? "";
  const topbarSizerRule =
    styles
      .match(
        /\.topbar \.utility-field \.select-wrap--account \.select-wrap__sizer \{[^}]*\}/g,
      )
      ?.find((rule) => rule.includes("font-size: 11.5px")) ?? "";

  // `display: none` would collapse the control; the sizer has to occupy space.
  assert.match(sizerRule, /visibility: hidden/);
  assert.doesNotMatch(sizerRule, /display: none/);
  assert.match(sizerRule, /white-space: nowrap/);
  // Last resort at very narrow widths: clip rather than overflow the bar.
  assert.match(sizerRule, /text-overflow: ellipsis/);

  // The final desktop contract is deliberately more legible than the old
  // compressed bar. The invisible sizer must use those same final metrics.
  assert.match(topbarSizerRule, /font-size: 11\.5px/);
  assert.match(topbarSizerRule, /line-height: 34px/);
  assert.match(topbarSizerRule, /height: 36px/);
});

test("the select overlays the sizer instead of sharing a grid cell with it", async () => {
  const styles = await readStyles();
  const overlayRule =
    styles.match(/\.select-wrap--account select \{[^}]*\}/g)?.find((rule) =>
      rule.includes("position: absolute"),
    ) ?? "";

  // The previous attempt stacked everything in one grid cell, which made the
  // chip and chevron width contributors and distorted the pill border.
  assert.match(overlayRule, /inset: 0/);
  assert.doesNotMatch(styles, /\.select-wrap--account \{[^}]*display: grid/);
  // The overlay needs the wrap's existing positioning context.
  assert.match(styles, /\.select-wrap \{\s*\n\s*position: relative;/);
});

test("the currency chip keeps its own place to the right of the name", async () => {
  const styles = await readStyles();
  const chipRule =
    styles.match(/\.select-wrap--account \.field-unit-chip \{[^}]*\}/)?.[0] ?? "";

  assert.match(chipRule, /right: 29px/);
  assert.match(chipRule, /pointer-events: none/);
  // 34px chip starting 29px from the edge needs 63px; both reserved values
  // clear it with room for the gap.
  assert.match(styles, /min-width: 34px/);
});

test("the utility bar keeps dynamic scope, operations, and session controls in separate zones", async () => {
  const [shell, frame, styles] = await Promise.all([
    readDashboardShell(),
    readAppFrame(),
    readStyles(),
  ]);

  assert.match(shell, /aria-label="Active dashboard scope"/);
  assert.match(shell, /<AccountField[\s\S]*accounts=\{accounts\}/);
  assert.match(
    shell,
    /<PlatformField[\s\S]*activePlatforms=\{activeAccount\.platforms\}/,
  );
  assert.match(shell, /aria-label="Live data operations"/);
  assert.match(frame, /aria-label="Display and account controls"/);
  assert.match(styles, /\.topbar__operations \{[^}]*display: inline-flex/);
  assert.match(styles, /\.topbar__session \{[^}]*margin-left: auto/);
  assert.match(styles, /\.topbar__context \{[^}]*margin-right: 0/);
});

test("the same topbar layout covers every configured brand and platform filter", async () => {
  const shell = await readDashboardShell();

  assert.equal(ACCOUNT_OPTIONS.length, 5);
  assert.match(shell, /value=\{account\}/);
  assert.match(shell, /value=\{filters\.platform\}/);
  assert.match(shell, /onChange=\{\(platform\) => void loadPlatform\(platform\)\}/);
});

test("the delivery trend fits its plot to the viewport without distorting SVG geometry", async () => {
  const [shell, chart, styles] = await Promise.all([
    readDashboardShell(),
    readLineChart(),
    readStyles(),
  ]);

  assert.match(shell, /<LineChart[\s\S]*fitContainer[\s\S]*height=\{320\}/);
  assert.match(chart, /new ResizeObserver/);
  assert.match(chart, /viewBox=\{`0 0 \$\{chartWidth\} \$\{chartHeight\}`\}/);
  assert.match(
    styles,
    /\.panel--trend \.trend-chart--fit-container \{[^}]*height: clamp\(280px, calc\(100dvh - 485px\), 460px\)/,
  );
});
