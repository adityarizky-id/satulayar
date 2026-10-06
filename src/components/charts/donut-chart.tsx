"use client";

import { useState } from "react";

import {
  ChartTooltip,
  tooltipToneForTrend,
  type TooltipState,
} from "@/components/charts/chart-tooltip";

export interface DonutSlice {
  key: string;
  label: string;
  value: number;
  previousValue?: number;
}

const RADIUS = 42;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function DonutChart({
  slices,
  formatValue,
  formatChange,
  ariaLabel,
  /** Names the baseline in the tooltip, e.g. "Same period last year". */
  comparisonLabel = "Previous period",
}: {
  slices: DonutSlice[];
  formatValue: (value: number) => string;
  formatChange?: (value: number, previousValue: number) => string;
  ariaLabel: string;
  comparisonLabel?: string;
}) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const segments = slices.reduce<
    { slice: DonutSlice; dash: number; offset: number; index: number }[]
  >((accumulated, slice, index) => {
    const previous = accumulated.at(-1);
    const dash = total === 0 ? 0 : (slice.value / total) * CIRCUMFERENCE;
    return [
      ...accumulated,
      {
        slice,
        dash,
        offset: previous ? previous.offset + previous.dash : 0,
        index,
      },
    ];
  }, []);

  const active = slices.find((slice) => slice.key === activeKey) ?? null;
  const tooltip: TooltipState | null = active
    ? {
        title: active.label,
        anchor: 0.5,
        rows: [
          { label: "Value", value: formatValue(active.value) },
          {
            label: "Share",
            value:
              total === 0 ? "0%" : `${((active.value / total) * 100).toFixed(1)}%`,
          },
          ...(active.previousValue === undefined
            ? []
            : [
                {
                  label: comparisonLabel,
                  value: formatValue(active.previousValue),
                  muted: true,
                },
                ...(formatChange
                  ? [
                      {
                        label: "Change",
                        value: formatChange(active.value, active.previousValue),
                        tone: tooltipToneForTrend(
                          active.value,
                          active.previousValue
                        ),
                      },
                    ]
                  : []),
              ]),
        ],
      }
    : null;

  return (
    <div className={`donut${activeKey === null ? "" : " donut--hovered"}`}>
      <div className="chart-plot donut__plot">
        <svg
          aria-label={ariaLabel}
          onMouseLeave={() => setActiveKey(null)}
          role="img"
          viewBox="0 0 120 120"
        >
          <circle className="donut__track" cx="60" cy="60" r={RADIUS} />
          {segments.map((segment) => (
            <circle
              className={`donut__segment donut__segment--${segment.index % 5} ${
                activeKey === segment.slice.key ? "donut__segment--active" : ""
              }`}
              cx="60"
              cy="60"
              key={segment.slice.key}
              onMouseEnter={() => setActiveKey(segment.slice.key)}
              r={RADIUS}
              strokeDasharray={`${segment.dash} ${CIRCUMFERENCE - segment.dash}`}
              strokeDashoffset={-segment.offset}
            />
          ))}
        </svg>
        <ChartTooltip state={tooltip} />
      </div>
      <ul className="donut__legend">
        {slices.map((slice, index) => {
          const sharePercent =
            total === 0 ? "0%" : `${((slice.value / total) * 100).toFixed(1)}%`;
          return (
            <li
              className={
                activeKey === slice.key ? "donut__legend-item--active" : ""
              }
              key={slice.key}
              onBlur={() => setActiveKey(null)}
              onFocus={() => setActiveKey(slice.key)}
              onMouseEnter={() => setActiveKey(slice.key)}
              onMouseLeave={() => setActiveKey(null)}
              tabIndex={0}
            >
              <i className={`legend-dot legend-dot--series-${index % 5}`} />
              <span className="donut__legend-label">{slice.label}</span>
              <strong className="donut__legend-value">{formatValue(slice.value)}</strong>
              <span
                aria-label={`Share: ${sharePercent}`}
                className="donut__legend-share"
                title={`Share of total: ${sharePercent}`}
              >
                {sharePercent}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
