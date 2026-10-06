"use client";

import { useState } from "react";

import {
  ChartTooltip,
  tooltipToneForTrend,
  type TooltipState,
} from "@/components/charts/chart-tooltip";

export interface BarListRow {
  key: string;
  label: string;
  value: number;
  /** Null when the reader switched comparison off; no delta is then shown. */
  previousValue: number | null;
  share: number;
}

export function BarList({
  rows,
  formatValue,
  formatChange,
  /** Names the baseline in the tooltip, e.g. "Same period last year". */
  comparisonLabel = "Previous period",
  className,
}: {
  rows: BarListRow[];
  formatValue: (value: number) => string;
  formatChange: (value: number, previousValue: number) => string;
  comparisonLabel?: string;
  className?: string;
}) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const max = Math.max(...rows.map((row) => row.value), 1);

  if (rows.length === 0) {
    return <div className="empty-state">No data for this date range.</div>;
  }

  const active = rows.find((row) => row.key === activeKey) ?? null;
  // With comparison off there is no baseline to name and no change to state,
  // so the tooltip says so once instead of printing a fabricated zero.
  const comparisonRows =
    active === null
      ? []
      : active.previousValue === null
        ? [{ label: "Comparison", value: "Off", muted: true }]
        : [
            {
              label: comparisonLabel,
              value: formatValue(active.previousValue),
              muted: true,
            },
            {
              label: "Change",
              value: formatChange(active.value, active.previousValue),
              tone: tooltipToneForTrend(active.value, active.previousValue),
            },
          ];
  const tooltip: TooltipState | null = active
    ? {
        title: active.label,
        anchor: 0.5,
        rows: [
          { label: "Value", value: formatValue(active.value) },
          ...comparisonRows,
          { label: "Share of total", value: `${(active.share * 100).toFixed(1)}%` },
        ],
      }
    : null;

  return (
    <div className="chart-plot">
      <ul
        className={`bar-list${className ? ` ${className}` : ""}${
          activeKey === null ? "" : " bar-list--hovered"
        }`}
      >
        {rows.map((row) => (
          <li
            className={activeKey === row.key ? "bar-list__row--active" : ""}
            key={row.key}
            onFocus={() => setActiveKey(row.key)}
            onMouseEnter={() => setActiveKey(row.key)}
            onMouseLeave={() => setActiveKey(null)}
            tabIndex={0}
          >
            <div className="bar-list__meta">
              <span className="bar-list__label">{row.label}</span>
              <span className="bar-list__value">{formatValue(row.value)}</span>
            </div>
            <div className="bar-list__track">
              <span
                className={`bar-list__fill ${
                  activeKey === row.key ? "bar-list__fill--active" : ""
                }`}
                style={{ width: `${Math.max((row.value / max) * 100, 2)}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
      <ChartTooltip state={tooltip} />
    </div>
  );
}
