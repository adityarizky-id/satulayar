"use client";

import { useMemo, useState } from "react";

import { RegionMap, type RegionMapDatum } from "@/components/geo/region-map";
import { ChevronIcon } from "@/components/dashboard/icons";
import type { GeoAnalysis } from "@/lib/dashboard/geo/analysis";
import type { GeoLevel } from "@/lib/dashboard/geo/contract";
import {
  countryShapeSet,
  resolveRegionPath,
} from "@/lib/dashboard/geo/shape-lookup";
import {
  evaluateGeoRow,
  type GeoVerdict,
} from "@/lib/dashboard/geo/verdict";
import type { PerformanceTargets } from "@/lib/dashboard/targets";
import type { Currency } from "@/lib/dashboard/types";

const VERDICT_LABEL: Record<GeoVerdict, string> = {
  pass: "inside target",
  near: "near target",
  breach: "over target",
  wasted: "no orders",
  insufficient: "too little data",
};

/** Colour is never the only signal: every region also carries the words above. */
const VERDICT_SHADE: Record<GeoVerdict, string> = {
  pass: "#cfe6d8",
  near: "#fbe7bf",
  breach: "#f6cdcf",
  wasted: "#e9a8ab",
  insufficient: "#e8ecef",
};

export interface GeoSelection {
  countryCode: string;
  level: GeoLevel;
  parentId: string | null;
}

export function GeoSection({
  analysis,
  currency,
  disabled,
  targets,
  onSelect,
}: {
  analysis: GeoAnalysis;
  currency: Currency;
  disabled: boolean;
  targets: PerformanceTargets;
  onSelect: (selection: GeoSelection) => void;
}) {
  const [shadeBy, setShadeBy] = useState<"spend" | "performance">("spend");

  const currencyFormatter = useMemo(
    () =>
      new Intl.NumberFormat("en-GB", {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
      }),
    [currency],
  );
  const numberFormatter = useMemo(
    () => new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }),
    [],
  );
  const verdicts = useMemo(() => {
    const map = new Map<string, ReturnType<typeof evaluateGeoRow>>();
    for (const row of analysis.rows) {
      map.set(row.target.id, evaluateGeoRow(row, targets, currency));
    }
    return map;
  }, [analysis.rows, targets, currency]);

  const maxSpend = Math.max(...analysis.rows.map((row) => row.spend), 1);
  const shapeSet = countryShapeSet(analysis.selectedCountry.code);
  // Boundaries exist for the province level only; deeper levels fall back to
  // tiles rather than borrowing the wrong shape.
  const shapesApply = analysis.selectedLevel === "province";
  const mapData: RegionMapDatum[] = analysis.rows.map((row, index) => ({
    id: row.target.id,
    name: row.target.name,
    levelLabel:
      analysis.levelOptions.find(
        (option) => option.level === analysis.selectedLevel,
      )?.label ?? analysis.selectedLevel,
    intensity: row.spend / maxSpend,
    shade:
      shadeBy === "performance"
        ? VERDICT_SHADE[
            verdicts.get(row.target.id)?.verdict ?? "insufficient"
          ]
        : undefined,
    tile: row.target.tile ?? { row: Math.floor(index / 4), column: index % 4 },
    path: shapesApply
      ? resolveRegionPath(analysis.selectedCountry.code, row.target.name)
      : null,
    hasChildren: analysis.drillLevel !== null,
    leadStats: [
      { label: "spend", value: currencyFormatter.format(row.spend) },
      { label: "regist.", value: numberFormatter.format(row.registrations) },
      { label: "orders", value: numberFormatter.format(row.purchases) },
    ],
    stats: [
      { label: "Spend", value: currencyFormatter.format(row.spend) },
      {
        label: "Clicks",
        value: `${numberFormatter.format(row.clicks)} · ${
          row.ctr === null ? "N/A" : `${(row.ctr * 100).toFixed(2)}% CTR`
        }`,
      },
      {
        label: "Registrations",
        value: numberFormatter.format(row.registrations),
      },
      { label: "Purchases", value: numberFormatter.format(row.purchases) },
      {
        label: "Purchase value",
        value: currencyFormatter.format(row.purchaseValue),
      },
      {
        label: "Cost per order",
        value:
          row.costPerPurchase === null
            ? "N/A"
            : currencyFormatter.format(row.costPerPurchase),
      },
      {
        label: "Against target",
        value:
          VERDICT_LABEL[verdicts.get(row.target.id)?.verdict ?? "insufficient"],
      },
    ],
  }));

  // Regions the country has but this period did not report, drawn behind the
  // data so the map is the whole country rather than a few floating shapes.
  const drawnNames = new Set(
    analysis.rows.map((row) => row.target.name.toLowerCase()),
  );
  const backdrop =
    shapesApply && shapeSet
      ? Object.entries(shapeSet.regions)
          .filter(([name]) => !drawnNames.has(name.toLowerCase()))
          .filter(
            ([name]) =>
              !analysis.rows.some(
                (row) =>
                  resolveRegionPath(
                    analysis.selectedCountry.code,
                    row.target.name,
                  ) === shapeSet.regions[name],
              ),
          )
          .map(([name, path]) => ({ name, path }))
      : [];

  /**
   * The level shown when a breadcrumb step is opened: the one immediately
   * below it. The country step has no entry in `levelOptions`, so it falls to
   * the first level the country actually reports.
   */
  function childLevelOf(level: GeoLevel): GeoLevel {
    if (level === "country") {
      return analysis.levelOptions[0]?.level ?? analysis.selectedLevel;
    }
    const index = analysis.levelOptions.findIndex(
      (option) => option.level === level,
    );
    return (
      analysis.levelOptions[index + 1]?.level ??
      analysis.levelOptions[index]?.level ??
      analysis.selectedLevel
    );
  }

  function drillInto(parentId: string) {
    if (!analysis.drillLevel) return;
    onSelect({
      countryCode: analysis.selectedCountry.code,
      level: analysis.drillLevel,
      parentId,
    });
  }

  return (
    <section className="section" id="geo-analysis">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Account diagnostic</span>
          <h2>Geography</h2>
        </div>
        <p>{analysis.safeMessage}</p>
      </div>

      <div className="geo-controls">
        <label className="field field--compact">
          <span>Country</span>
          <span className="select-wrap">
            <select
              disabled={disabled}
              onChange={(event) => {
                onSelect({
                  countryCode: event.target.value,
                  level: "province",
                  parentId: null,
                });
              }}
              value={analysis.selectedCountry.code}
            >
              {analysis.countries.map((country) => (
                <option key={country.code} value={country.code}>
                  {country.name}
                  {country.isPrimary ? " · home market" : ""}
                </option>
              ))}
            </select>
            <ChevronIcon />
          </span>
        </label>

        <label className="field field--compact">
          <span>Level</span>
          <span className="select-wrap">
            <select
              disabled={disabled}
              onChange={(event) => {
                onSelect({
                  countryCode: analysis.selectedCountry.code,
                  level: event.target.value as GeoLevel,
                  parentId: null,
                });
              }}
              value={analysis.selectedLevel}
            >
              {analysis.levelOptions.map((option) => (
                <option key={option.level} value={option.level}>
                  {option.label}
                </option>
              ))}
            </select>
            <ChevronIcon />
          </span>
        </label>

        <nav aria-label="Geography drill path" className="geo-breadcrumb">
          {analysis.breadcrumb.map((entry, index) => {
            const isCurrent = index === analysis.breadcrumb.length - 1;
            return (
              <span key={entry.id ?? "country"}>
                {index > 0 && <i aria-hidden="true">/</i>}
                <button
                  aria-current={isCurrent ? "location" : undefined}
                  className={isCurrent ? "is-current" : undefined}
                  disabled={disabled || isCurrent}
                  onClick={() => {
                    // Clicking a step shows what sits inside it, which is the
                    // same move the drill button makes. Keeping the current
                    // level here meant clicking "Wales" while at City asked
                    // for cities parented by a region — and got nothing.
                    onSelect({
                      countryCode: analysis.selectedCountry.code,
                      level: childLevelOf(entry.level),
                      parentId: entry.id,
                    });
                  }}
                  type="button"
                >
                  {entry.name}
                </button>
              </span>
            );
          })}
        </nav>
      </div>

      <div className="geo-shade-toggle" role="group" aria-label="Map shading">
        <span>Shade the map by</span>
        <button
          aria-pressed={shadeBy === "spend"}
          className={shadeBy === "spend" ? "is-active" : undefined}
          onClick={() => setShadeBy("spend")}
          type="button"
        >
          Spend
        </button>
        <button
          aria-pressed={shadeBy === "performance"}
          className={shadeBy === "performance" ? "is-active" : undefined}
          onClick={() => setShadeBy("performance")}
          type="button"
        >
          Cost per order vs target
        </button>
        {shadeBy === "performance" && (
          <ul className="geo-shade-legend">
            {(
              ["pass", "near", "breach", "wasted", "insufficient"] as GeoVerdict[]
            ).map((verdict) => (
              <li key={verdict}>
                <i style={{ background: VERDICT_SHADE[verdict] }} />
                {VERDICT_LABEL[verdict]}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="geo-diagnostic">
        <article className="panel panel--geo-map">
          <RegionMap
            backdrop={backdrop}
            data={mapData}
            fallbackNote={
              shapesApply
                ? undefined
                : "Boundaries are shipped for the top level only, so this depth is shown as tiles."
            }
            onSelect={drillInto}
            shadeLabel={
              shadeBy === "performance"
                ? "cost per order against target"
                : "relative spend"
            }
            viewBox={shapesApply ? (shapeSet?.viewBox ?? null) : null}
          />
        </article>
      </div>
    </section>
  );
}
