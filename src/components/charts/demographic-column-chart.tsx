"use client";

import { useState } from "react";
import {
  ChartTooltip,
  type TooltipState,
} from "@/components/charts/chart-tooltip";

export interface DemographicAgeGroup {
  key: string;
  age: string;
  femaleSpend: number;
  maleSpend: number;
  totalSpend: number;
  purchases?: number;
  roas?: number | null;
}

export interface DemographicColumnChartProps {
  ariaLabel: string;
  ageGroups: DemographicAgeGroup[];
  totalFemaleSpend: number;
  totalMaleSpend: number;
  femaleOverallShare: number;
  maleOverallShare: number;
  formatValue: (value: number) => string;
  femaleLabel?: string;
  maleLabel?: string;
  footnote?: string;
}

const WIDTH = 760;
const HEIGHT = 220;
const PADDING_TOP = 20;
const PADDING_BOTTOM = 30;
const PADDING_X = 36;

export function DemographicColumnChart({
  ariaLabel,
  ageGroups,
  totalFemaleSpend,
  totalMaleSpend,
  femaleOverallShare,
  maleOverallShare,
  formatValue,
  femaleLabel = "Women",
  maleLabel = "Men",
  footnote,
}: DemographicColumnChartProps) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [focusSeries, setFocusSeries] = useState<"female" | "male" | null>(null);

  const allBarValues = ageGroups.flatMap((g) => [g.femaleSpend, g.maleSpend]);
  const maxBar = Math.max(...allBarValues, 0.000_001);

  const plotWidth = WIDTH - PADDING_X * 2;
  const plotHeight = HEIGHT - PADDING_TOP - PADDING_BOTTOM;
  const slotWidth = ageGroups.length === 0 ? plotWidth : plotWidth / ageGroups.length;
  const barWidth = Math.min(10, Math.max(4, slotWidth * 0.18));
  const barGap = 4;

  function slotCentre(index: number) {
    return PADDING_X + slotWidth * index + slotWidth / 2;
  }

  const active = ageGroups.find((g) => g.key === activeKey) ?? null;
  const activeIndex = active ? ageGroups.findIndex((g) => g.key === active.key) : 0;
  const anchor =
    ageGroups.length <= 1 ? 0.5 : activeIndex / Math.max(ageGroups.length - 1, 1);

  const tooltip: TooltipState | null = active
    ? {
        title: `Age ${active.age}`,
        anchor,
        rows: [
          {
            label: femaleLabel,
            value: formatValue(active.femaleSpend),
            swatch: "legend-dot--demographic-female",
            muted: focusSeries === "male",
          },
          {
            label: maleLabel,
            value: formatValue(active.maleSpend),
            swatch: "legend-dot--demographic-male",
            muted: focusSeries === "female",
          },
          {
            label: "Total age spend",
            value: formatValue(active.totalSpend),
          },
          ...(active.purchases !== undefined && active.purchases > 0
            ? [{ label: "Purchases", value: `${active.purchases}` }]
            : []),
          ...(active.roas !== null && active.roas !== undefined
            ? [{ label: "ROAS", value: `${active.roas.toFixed(2)}×` }]
            : []),
        ],
      }
    : null;

  return (
    <div className="demographic-chart-wrapper">
      <div
        className={`chart-shell chart-shell--interactive${
          activeKey === null ? "" : " chart-shell--dimmed"
        }${focusSeries === null ? "" : " chart-shell--series-focus"}`}
      >
        <div className="chart-plot demographic-chart-plot">
          <svg
            aria-label={ariaLabel}
            className="demographic-column-chart"
            onMouseLeave={() => setActiveKey(null)}
            role="img"
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          >
            {/* Subtle background grid lines */}
            {[0.25, 0.5, 0.75, 1].map((fraction) => {
              const y = PADDING_TOP + plotHeight * (1 - fraction);
              return (
                <line
                  className="chart-grid-line"
                  key={fraction}
                  x1={PADDING_X}
                  x2={WIDTH - PADDING_X}
                  y1={y}
                  y2={y}
                />
              );
            })}

            {/* Grouped Bars */}
            {ageGroups.map((group, groupIndex) => {
              const centre = slotCentre(groupIndex);
              const totalGroupWidth = barWidth * 2 + barGap;
              const femaleX = centre - totalGroupWidth / 2;
              const maleX = femaleX + barWidth + barGap;

              const femaleHeight = (group.femaleSpend / maxBar) * plotHeight;
              const maleHeight = (group.maleSpend / maxBar) * plotHeight;

              const isGroupActive = activeKey === group.key;

              return (
                <g key={group.key}>
                  {/* Female Bar */}
                  <rect
                    className={`demographic-bar demographic-bar--female${
                      isGroupActive ? " demographic-bar--active" : ""
                    }${focusSeries === "female" ? " demographic-bar--focus" : ""}${
                      focusSeries === "male" ? " demographic-bar--dimmed" : ""
                    }`}
                    height={Math.max(femaleHeight, 0)}
                    rx={1.5}
                    ry={1.5}
                    width={barWidth}
                    x={femaleX}
                    y={PADDING_TOP + plotHeight - Math.max(femaleHeight, 0)}
                  />

                  {/* Male Bar */}
                  <rect
                    className={`demographic-bar demographic-bar--male${
                      isGroupActive ? " demographic-bar--active" : ""
                    }${focusSeries === "male" ? " demographic-bar--focus" : ""}${
                      focusSeries === "female" ? " demographic-bar--dimmed" : ""
                    }`}
                    height={Math.max(maleHeight, 0)}
                    rx={1.5}
                    ry={1.5}
                    width={barWidth}
                    x={maleX}
                    y={PADDING_TOP + plotHeight - Math.max(maleHeight, 0)}
                  />
                </g>
              );
            })}

            {/* Invisible interactive hit targets */}
            {ageGroups.map((group, index) => (
              <rect
                className="chart-hit"
                height={HEIGHT}
                key={`hit:${group.key}`}
                onBlur={() => setActiveKey(null)}
                onFocus={() => setActiveKey(group.key)}
                onMouseEnter={() => setActiveKey(group.key)}
                tabIndex={0}
                width={slotWidth}
                x={PADDING_X + slotWidth * index}
                y={0}
              />
            ))}
          </svg>

          {/* Interactive Tooltip */}
          <ChartTooltip state={tooltip} />
        </div>

        {/* X-Axis Labels */}
        <div className="demographic-column-axis">
          {ageGroups.map((group) => (
            <span
              className={`demographic-axis-label${
                activeKey === group.key ? " demographic-axis-label--active" : ""
              }`}
              key={`axis:${group.key}`}
            >
              {group.age}
            </span>
          ))}
        </div>

        {/* Bottom Legend with Total Shares */}
        <div className="demographic-legend-container">
          <button
            className={`demographic-legend-item${
              focusSeries === "female" ? " demographic-legend-item--active" : ""
            }`}
            onBlur={() => setFocusSeries(null)}
            onFocus={() => setFocusSeries("female")}
            onMouseEnter={() => setFocusSeries("female")}
            onMouseLeave={() => setFocusSeries(null)}
            type="button"
          >
            <span className="demographic-legend-swatch demographic-legend-swatch--female" />
            <div className="demographic-legend-text">
              <strong className="demographic-legend-title">{femaleLabel}</strong>
              <span className="demographic-legend-share">
                {formatValue(totalFemaleSpend)} · {femaleOverallShare.toFixed(1)}%
              </span>
            </div>
          </button>

          <button
            className={`demographic-legend-item${
              focusSeries === "male" ? " demographic-legend-item--active" : ""
            }`}
            onBlur={() => setFocusSeries(null)}
            onFocus={() => setFocusSeries("male")}
            onMouseEnter={() => setFocusSeries("male")}
            onMouseLeave={() => setFocusSeries(null)}
            type="button"
          >
            <span className="demographic-legend-swatch demographic-legend-swatch--male" />
            <div className="demographic-legend-text">
              <strong className="demographic-legend-title">{maleLabel}</strong>
              <span className="demographic-legend-share">
                {formatValue(totalMaleSpend)} · {maleOverallShare.toFixed(1)}%
              </span>
            </div>
          </button>
        </div>

        {footnote && (
          <details className="card-notes">
            <summary>Demographic coverage</summary>
            <p>{footnote}</p>
          </details>
        )}
      </div>
    </div>
  );
}
