"use client";

import { useState } from "react";

import { ChartTooltip, type TooltipState } from "@/components/charts/chart-tooltip";

export interface StackedShareSegment {
  key: string;
  label: string;
  value: number | null;
  /** True when the source masked the figure, e.g. Google's "< 10%". */
  masked?: boolean;
}

export interface StackedShareRow {
  key: string;
  label: string;
  note?: string;
  segments: StackedShareSegment[];
  extraRows?: { label: string; value: string; muted?: boolean }[];
}

/**
 * One row per entity, split into shares that add up to the whole. A masked
 * segment is drawn with a hatch instead of a solid fill, so a censored value is
 * never mistaken for a measured one.
 */
export function StackedShareBars({
  rows,
  legend,
  formatShare,
  maskedLabel = "masked",
  maskedCeiling = 0.1,
}: {
  rows: StackedShareRow[];
  legend: string[];
  formatShare: (value: number) => string;
  maskedLabel?: string;
  /** Width drawn for a masked segment: the ceiling the source guarantees. */
  maskedCeiling?: number;
}) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const active = rows.find((row) => row.key === activeKey) ?? null;
  const tooltip: TooltipState | null = active
    ? {
        title: active.note ? `${active.label} · ${active.note}` : active.label,
        anchor: 0.5,
        rows: [
          ...active.segments.map((segment, index) => ({
            label: segment.label,
            value:
              segment.masked || segment.value === null
                ? maskedLabel
                : formatShare(segment.value),
            swatch: `legend-dot--share-${index}`,
            muted: segment.masked === true || segment.value === null,
          })),
          ...(active.extraRows ?? []),
        ],
      }
    : null;

  return (
    <div className="chart-plot">
      <div className="chart-legend" aria-hidden="true">
        {legend.map((label, index) => (
          <span key={label}>
            <i className={`legend-dot legend-dot--share-${index}`} />
            {label}
          </span>
        ))}
        <span>
          <i className="legend-dot legend-dot--masked" />
          {maskedLabel}
        </span>
      </div>
      <ul className="share-bars">
        {rows.map((row) => {
          const measured = row.segments.reduce(
            (total, segment) =>
              segment.masked || segment.value === null
                ? total + maskedCeiling
                : total + segment.value,
            0,
          );
          const unknown = Math.max(0, 1 - measured);

          return (
            <li
              key={row.key}
              onFocus={() => setActiveKey(row.key)}
              onMouseEnter={() => setActiveKey(row.key)}
              onMouseLeave={() => setActiveKey(null)}
              tabIndex={0}
            >
              <span className="share-bars__label">
                <span className="share-bars__name">{row.label}</span>
                {row.note && (
                  <span
                    className={`share-bars__badge share-bars__badge--${row.note.toLowerCase().trim()}`}
                  >
                    {row.note}
                  </span>
                )}
              </span>
              <span className="share-bars__track">
                {row.segments.map((segment, index) =>
                  segment.masked || segment.value === null ? (
                    // A masked share is still a real, non-zero share: the bar
                    // shows a hatched sliver so "small" never reads as "none".
                    <span
                      className={`share-bars__segment share-bars__segment--${index} share-bars__segment--capped`}
                      key={segment.key}
                      style={{ width: `${maskedCeiling * 100}%` }}
                      title={`${segment.label}: ${maskedLabel}`}
                    >
                      <i aria-hidden="true">&lt;10%</i>
                    </span>
                  ) : (
                    <span
                      className={`share-bars__segment share-bars__segment--${index}`}
                      key={segment.key}
                      style={{ width: `${Math.max(segment.value * 100, 0)}%` }}
                      title={`${segment.label}: ${formatShare(segment.value)}`}
                    >
                      {segment.value >= 0.1 ? formatShare(segment.value) : ""}
                    </span>
                  ),
                )}
                {unknown > 0.001 && (
                  <span
                    className="share-bars__segment share-bars__segment--unknown"
                    style={{ width: `${unknown * 100}%` }}
                    title={`Unreported: ${formatShare(unknown)}`}
                  >
                    {unknown >= 0.12 ? "unreported" : ""}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      <ChartTooltip state={tooltip} />
    </div>
  );
}
