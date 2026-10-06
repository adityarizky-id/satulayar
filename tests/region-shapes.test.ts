import assert from "node:assert/strict";
import test from "node:test";

import { buildGeoAnalysis } from "../src/lib/dashboard/geo/analysis";
import { createFixtureGeoSource } from "../src/lib/dashboard/geo/fixture-source";
import { REGION_SHAPES } from "../src/lib/dashboard/geo/region-shapes";
import {
  countryShapeSet,
  hasShapesFor,
  normaliseRegionName,
  resolveRegionPath,
} from "../src/lib/dashboard/geo/shape-lookup";

const RANGE = { start: "2026-07-01", end: "2026-07-14" };

test("boundaries ship for every market the fixture covers", () => {
  for (const code of ["ID", "MY", "SG"]) {
    assert.equal(hasShapesFor(code), true);
    assert.notEqual(countryShapeSet(code), null);
  }
  assert.equal(hasShapesFor("XX"), false);
});

test("small provinces survive simplification on a wide country", () => {
  // Jakarta and Yogyakarta are tiny next to Papua; a global area floor used to
  // drop them, leaving the capital with nothing to draw.
  for (const name of ["Jakarta Raya", "Yogyakarta", "Kepulauan Riau"]) {
    assert.ok(REGION_SHAPES.ID?.regions[name], `ID/${name} has a shape`);
  }
  assert.ok(REGION_SHAPES.MY?.regions["Kuala Lumpur"]);
});

test("every shape is a closed SVG path in its country's viewBox", () => {
  for (const [code, set] of Object.entries(REGION_SHAPES)) {
    assert.match(set.viewBox, /^0 0 \d+ \d+$/);
    for (const [name, path] of Object.entries(set.regions)) {
      assert.equal(path.startsWith("M"), true, `${code}/${name} starts with M`);
      assert.equal(path.endsWith("Z"), true, `${code}/${name} is closed`);
      assert.doesNotMatch(path, /NaN|Infinity/);
    }
  }
});

test("name matching survives diacritics, case, and the local word for the level", () => {
  assert.equal(normaliseRegionName("Jawá Barat"), "jawa barat");
  assert.equal(normaliseRegionName("Penang County"), "penang");
  assert.equal(normaliseRegionName("Riau Province"), "riau");
  assert.equal(normaliseRegionName("DKI Jakarta"), "dki jakarta");
});

test("a region resolves to a boundary even when the platform names it differently", () => {
  // Exact, case-insensitive, and alias paths all have to work.
  assert.notEqual(resolveRegionPath("ID", "Bali"), null);
  assert.notEqual(resolveRegionPath("ID", "bali"), null);
  assert.notEqual(resolveRegionPath("ID", "West Java"), null);
  assert.notEqual(resolveRegionPath("ID", "DKI Jakarta"), null);
  assert.notEqual(resolveRegionPath("MY", "Federal Territory of Kuala Lumpur"), null);
  assert.notEqual(resolveRegionPath("MY", "Penang"), null);
});

test("a region spanning several boundary features joins them into one shape", () => {
  const jabodetabek = resolveRegionPath("ID", "Jabodetabek");
  const jakartaOnly = resolveRegionPath("ID", "Jakarta");

  assert.notEqual(jabodetabek, null);
  assert.notEqual(jakartaOnly, null);
  // Jabodetabek covers Jakarta plus two more provinces, so its path is longer.
  assert.equal((jabodetabek ?? "").length > (jakartaOnly ?? "").length, true);
});

test("an unknown region returns null instead of the wrong shape", () => {
  assert.equal(resolveRegionPath("ID", "Atlantis"), null);
  assert.equal(resolveRegionPath("XX", "Bali"), null);
});

test("every province the dashboard shows has a boundary to draw", () => {
  const source = createFixtureGeoSource();

  for (const accountSlug of [
    "kopi-senja",
    "batik-lestari",
    "rumah-rajut",
    "jamu-alami",
    "kriya-bali",
  ]) {
    const countries = source.listCountries(accountSlug);

    for (const country of countries) {
      const analysis = buildGeoAnalysis({
        source,
        accountSlug,
        range: RANGE,
        currency: "USD",
        countryCode: country.code,
      });

      for (const row of analysis.rows) {
        assert.notEqual(
          resolveRegionPath(country.code, row.target.name),
          null,
          `${country.code}: no boundary for ${row.target.name}`,
        );
      }
    }
  }
});
