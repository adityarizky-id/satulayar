"use client";

import { useState } from "react";

import {
  ChartTooltip,
  type TooltipRow,
  type TooltipState,
} from "@/components/charts/chart-tooltip";
import { smoothLinePath } from "@/components/charts/smooth-line";

export interface ColumnGroup {
  key: string;
  label: string;
  /** Used in the tooltip when the axis label has to stay short. */
  tooltipTitle?: string;
  /** One bar per series, in the order given by `seriesLabels`. */
  bars: (number | null)[];
  /** Optional secondary measure drawn as a line, e.g. order count. */
  lineValue?: number | null;
  /** Extra rows appended to the tooltip, already formatted. */
  extraRows?: TooltipRow[];
  isPartial?: boolean;
}

export interface ColumnChartProps {
  ariaLabel: string;
  groups: ColumnGroup[];
  seriesLabels: string[];
  formatValue: (value: number) => string;
  lineLabel?: string;
  formatLineValue?: (value: number) => string;
}

const WIDTH = 760;
const HEIGHT = 240;
const PADDING = 26;

export function ColumnChart({
  ariaLabel,
  groups,
  seriesLabels,
  formatValue,
  lineLabel,
  formatLineValue,
}: ColumnChartProps) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  // Legend hover picks one series out of the group; the column hover picks one
  // period. They are different questions, so they are separate states.
  const [focusSeries, setFocusSeries] = useState<number | null>(null);

  const barValues = groups.flatMap((group) =>
    group.bars.filter((value): value is number => value !== null),
  );
  const maxBar = Math.max(...barValues, 0.000_001);
  const lineValues = groups
    .map((group) => group.lineValue)
    .filter((value): value is number => value !== null && value !== undefined);
  const maxLine = Math.max(...lineValues, 0.000_001);

  const plotWidth = WIDTH - PADDING * 2;
  const plotHeight = HEIGHT - PADDING * 2;
  const slotWidth = groups.length === 0 ? plotWidth : plotWidth / groups.length;
  const barGap = 4;
  const barWidth = Math.min(10, Math.max(2,
    (slotWidth * 0.62 - barGap * (seriesLabels.length - 1)) / Math.max(seriesLabels.length, 1),
  ));

  function slotCentre(index: number) {
    return PADDING + slotWidth * index + slotWidth / 2;
  }

  const active = groups.find((group) => group.key === activeKey) ?? null;
  const tooltip: TooltipState | null = active
    ? {
        title: `${active.tooltipTitle ?? active.label}${
          active.isPartial ? " · partial month" : ""
        }`,
        anchor:
          groups.length <= 1
            ? 0.5
            : groups.findIndex((group) => group.key === active.key) /
              (groups.length - 1),
        rows: [
          ...active.bars.map((value, index) => ({
            label: seriesLabels[index] ?? `Series ${index + 1}`,
            value: value === null ? "N/A" : formatValue(value),
            swatch: `legend-dot--series-${index % 5}`,
            muted: value === null,
          })),
          ...(lineLabel !== undefined &&
          active.lineValue !== null &&
          active.lineValue !== undefined
            ? [
                {
                  label: lineLabel,
                  value: (formatLineValue ?? formatValue)(active.lineValue),
                  swatch: "legend-dot--line",
                },
              ]
            : []),
          ...(active.extraRows ?? []),
        ],
      }
    : null;

  const linePath = smoothLinePath(
    groups
      .map((group, index) =>
        group.lineValue === null || group.lineValue === undefined
          ? null
          : {
              x: slotCentre(index),
              y: HEIGHT - PADDING - (group.lineValue / maxLine) * plotHeight,
            },
      )
      .filter((point): point is { x: number; y: number } => point !== null),
  );

  return (
    <div
      className={`chart-shell chart-shell--interactive${
        activeKey === null ? "" : " chart-shell--dimmed"
      }${focusSeries === null ? "" : " chart-shell--series-focus"}`}
    >
      <div
        className={`chart-legend${
          focusSeries === null ? "" : " chart-legend--focused"
        }`}
      >
        {seriesLabels.map((label, index) => (
          <button
            className={
              focusSeries === index ? "chart-legend__item--focus" : undefined
            }
            key={label}
            onBlur={() => setFocusSeries(null)}
            onFocus={() => setFocusSeries(index)}
            onMouseEnter={() => setFocusSeries(index)}
            onMouseLeave={() => setFocusSeries(null)}
            type="button"
          >
            <i className={`legend-dot legend-dot--series-${index % 5}`} />
            {label}
          </button>
        ))}
        {lineLabel && (
          <span>
            <i className="legend-dot legend-dot--line" />
            {lineLabel}
          </span>
        )}
      </div>
      <div className="chart-plot">
        <svg
          aria-label={ariaLabel}
          className="column-chart"
          onMouseLeave={() => setActiveKey(null)}
          role="img"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        >
          {[0.25, 0.5, 0.75, 1].map((fraction) => (
            <line
              className="chart-grid-line"
              key={fraction}
              x1={PADDING}
              x2={WIDTH - PADDING}
              y1={PADDING + plotHeight * fraction}
              y2={PADDING + plotHeight * fraction}
            />
          ))}

          {groups.map((group, groupIndex) => {
            const centre = slotCentre(groupIndex);
            const groupWidth = barWidth * group.bars.length + barGap * (group.bars.length - 1);

            return (
              <g key={group.key}>
                {group.bars.map((value, barIndex) => {
                  if (value === null) return null;
                  const height = (value / maxBar) * plotHeight;
                  return (
                    <rect
                      className={`column-bar column-bar--${barIndex % 5}${
                        group.isPartial ? " column-bar--partial" : ""
                      }${activeKey === group.key ? " column-bar--active" : ""}${
                        focusSeries === barIndex ? " column-bar--focus" : ""
                      }`}
                      height={Math.max(height, 0)}
                      key={`${group.key}:${barIndex}`}
                      rx={1.5}
                      ry={1.5}
                      width={barWidth}
                      x={centre - groupWidth / 2 + barIndex * (barWidth + barGap)}
                      y={HEIGHT - PADDING - Math.max(height, 0)}
                    />
                  );
                })}
              </g>
            );
          })}

          {linePath && (
            <path className="chart-line chart-line--line" d={linePath} fill="none" />
          )}

          {groups.map((group, index) => (
            <rect
              className="chart-hit"
              height={HEIGHT}
              key={`hit:${group.key}`}
              onBlur={() => setActiveKey(null)}
              onFocus={() => setActiveKey(group.key)}
              onMouseEnter={() => setActiveKey(group.key)}
              tabIndex={0}
              width={slotWidth}
              x={PADDING + slotWidth * index}
              y={0}
            />
          ))}
        </svg>
        <ChartTooltip state={tooltip} />
      </div>
      <div className="column-axis">
        {groups.map((group) => (
          <span key={`axis:${group.key}`}>{group.label}</span>
        ))}
      </div>
    </div>
  );
}
