"use client";

import { useState, type CSSProperties } from "react";

export interface RegionMapDatum {
  id: string;
  name: string;
  levelLabel: string;
  /** Drives the resting shade: 0 is the quietest region, 1 the strongest. */
  intensity: number;
  /** Overrides the intensity ramp, e.g. when shading by verdict. */
  shade?: string;
  tile: { row: number; column: number };
  /** Boundary path when one is available for this region. */
  path?: string | null;
  stats: { label: string; value: string }[];
  leadStats: { label: string; value: string }[];
  hasChildren: boolean;
}

/**
 * Region map. Regions rest on a grey sequential ramp so magnitude is readable
 * without colour, and the region under the pointer lifts into the brand green
 * with its own snapshot.
 *
 * Two renderers, one behaviour: real boundaries when the country has them, and
 * a tile fallback when it does not, so a market without geometry still gets
 * the same interaction rather than an empty panel.
 */
export function RegionMap({
  data,
  viewBox,
  backdrop = [],
  onSelect,
  emptyMessage = "No region reported spend in this period.",
  fallbackNote,
  shadeLabel = "spend",
}: {
  data: RegionMapDatum[];
  viewBox?: string | null;
  /** Regions of the country with no data this period, drawn as context. */
  backdrop?: { name: string; path: string }[];
  onSelect?: (id: string) => void;
  emptyMessage?: string;
  fallbackNote?: string;
  /** What the shading encodes, so the name and the hint stay truthful. */
  shadeLabel?: string;
}) {
  // Hover stays inside the map on purpose. Letting the region cards drive it
  // resized this panel, which moved the cards, which re-fired their own hover
  // handlers — a loop the reader saw as flicker.
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = data.find((item) => item.id === activeId) ?? null;

  if (data.length === 0) {
    return <div className="empty-state">{emptyMessage}</div>;
  }

  const drawable = data.filter((item) => Boolean(item.path));
  const usesShapes = viewBox !== null && viewBox !== undefined && drawable.length > 0;
  const columns = Math.max(...data.map((item) => item.tile.column)) + 1;
  const shade = (item: RegionMapDatum) =>
    item.shade ?? `hsl(206 12% ${92 - Math.round(item.intensity * 26)}%)`;
  const shadeStyle = (item: RegionMapDatum) =>
    ({ "--region-map-shade": shade(item) }) as CSSProperties;

  return (
    <div className="region-map">
      {usesShapes ? (
        <div className="region-map__canvas">
          <svg
            aria-label={`Regions shaded by ${shadeLabel}`}
            onMouseLeave={() => setActiveId(null)}
            role="img"
            viewBox={viewBox}
          >
            {/* Regions with no spend still get drawn, so the country reads as a
                whole and an empty region is visibly empty, not missing. */}
            {backdrop.map((region) => (
              <path
                className="region-shape region-shape--empty"
                d={region.path}
                key={`backdrop-${region.name}`}
              >
                <title>{`${region.name}: no spend recorded`}</title>
              </path>
            ))}
            {data.map((item) =>
              item.path ? (
                <path
                  className={`region-shape ${
                    item.id === activeId ? "region-shape--active" : ""
                  }`}
                  d={item.path}
                  key={item.id}
                  onClick={() => item.hasChildren && onSelect?.(item.id)}
                  onMouseEnter={() => setActiveId(item.id)}
                  style={shadeStyle(item)}
                >
                  <title>{`${item.name}: ${item.leadStats
                    .map((stat) => `${stat.label} ${stat.value}`)
                    .join(", ")}`}</title>
                </path>
              ) : null,
            )}
          </svg>
          {drawable.length < data.length && (
            <p className="region-map__hint">
              {data.length - drawable.length} region(s) have no boundary in the
              shipped map and are listed below instead.
            </p>
          )}
        </div>
      ) : (
        <div
          className="region-map__grid"
          onMouseLeave={() => setActiveId(null)}
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {data.map((item) => {
            const isActive = item.id === activeId;

            return (
              <button
                aria-label={`${item.name}, ${item.levelLabel}`}
                className={`region-map__cell ${
                  isActive ? "region-map__cell--active" : ""
                }`}
                key={item.id}
                onBlur={() => setActiveId(null)}
                onClick={() => item.hasChildren && onSelect?.(item.id)}
                onFocus={() => setActiveId(item.id)}
                onMouseEnter={() => setActiveId(item.id)}
                style={shadeStyle(item)}
                type="button"
              >
                <span className="region-map__name">{item.name}</span>
                <span className="region-map__lead">
                  {item.leadStats.map((stat) => (
                    <b key={stat.label}>
                      {stat.value}
                      <i>{stat.label}</i>
                    </b>
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <aside className="region-map__panel">
        {active ? (
          <>
            <span className="eyebrow">{active.levelLabel}</span>
            <h3>{active.name}</h3>
            <dl>
              {active.stats.map((stat) => (
                <div key={stat.label}>
                  <dt>{stat.label}</dt>
                  <dd>{stat.value}</dd>
                </div>
              ))}
            </dl>
            {active.hasChildren && (
              <p className="region-map__hint">
                Select the region to drill into it.
              </p>
            )}
          </>
        ) : (
          <>
            <span className="eyebrow">Region snapshot</span>
            <h3>Hover a region</h3>
            <p className="region-map__hint">
              Shade shows {shadeLabel}. The region under the pointer takes the
              accent colour and reports its own figures here.
            </p>
            {!usesShapes && fallbackNote && (
              <p className="region-map__hint">{fallbackNote}</p>
            )}
          </>
        )}
      </aside>
    </div>
  );
}
