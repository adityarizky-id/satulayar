"use client";

import { useState } from "react";

import { ChartTooltip, type TooltipState } from "@/components/charts/chart-tooltip";

export interface StackedBarMonth {
  month: string;
  label: string;
  /** Calendar placeholder after the latest available date; never equivalent to zero. */
  isFuture: boolean;
  isPartial: boolean;
  throughDay: number | null;
  /** Value per segment key, in `segments` order. */
  values: Record<string, number>;
  /** Everything outside the tracked segment set. Zero when there is none. */
  other: number;
}

export interface StackedBarYear {
  year: number;
  months: StackedBarMonth[];
}

export interface StackedBarSegment {
  key: string;
  label: string;
}

export interface StackedBarChartProps {
  ariaLabel: string;
  /** Oldest year first; the two most recent years are selected by default. */
  years: StackedBarYear[];
  /** Stacking order, bottom to top. The catalogue palette supports 20 segments. */
  segments: StackedBarSegment[];
  /** Shown as the always-last, always-neutral top segment when present. */
  otherLabel: string;
  formatValue: (value: number) => string;
  /** When provided, synchronises the chart's focused year with the parent panel table. */
  focusYear?: number | null;
  /** Callback when focus year changes or is toggled. */
  onFocusYearChange?: (year: number | null) => void;
}

const WIDTH = 960;
const HEIGHT = 300;
const LEFT = 52;
const RIGHT = 16;
const TOP = 18;
const BOTTOM = 32;
const SERIES_COLOR_COUNT = 20;

export function getStackedMonthCentre(index: number, monthCount: number): number {
  const safeMonthCount = Math.max(monthCount, 1);
  const slotWidth = (WIDTH - LEFT - RIGHT) / safeMonthCount;

  return LEFT + slotWidth * index + slotWidth / 2;
}

function monthTotal(month: StackedBarMonth, segments: StackedBarSegment[]): number {
  return (
    segments.reduce((total, segment) => total + (month.values[segment.key] ?? 0), 0) +
    month.other
  );
}

export function buildStackedSegmentTooltip({
  month,
  monthIndex,
  monthCount,
  year,
  segmentKey,
  segments,
  otherLabel,
  formatValue,
}: {
  month: StackedBarMonth;
  monthIndex: number;
  monthCount: number;
  year: number;
  segmentKey: string;
  segments: StackedBarSegment[];
  otherLabel: string;
  formatValue: (value: number) => string;
}): TooltipState | null {
  if (month.isFuture) return null;

  const isOther = segmentKey === "other";
  const segmentIndex = segments.findIndex((segment) => segment.key === segmentKey);
  const segment = segmentIndex >= 0 ? segments[segmentIndex] : null;

  if (!isOther && segment === null) return null;

  const value = isOther ? month.other : (month.values[segmentKey] ?? 0);
  if (value <= 0) return null;

  const total = monthTotal(month, segments);
  const share = total > 0 ? (value / total) * 100 : 0;
  const periodSuffix =
    month.isPartial && month.throughDay ? ` · 1–${month.throughDay}` : "";

  return {
    title: `${isOther ? otherLabel : segment?.label} · ${month.label} ${year}${periodSuffix}`,
    anchor: monthCount > 1 ? monthIndex / (monthCount - 1) : 0.5,
    rows: [
      {
        label: "Sales",
        value: formatValue(value),
        swatch: isOther
          ? "legend-dot--catalogue-other"
          : `legend-dot--catalogue-${segmentIndex % SERIES_COLOR_COUNT}`,
      },
      { label: "Share of month", value: `${share.toFixed(1)}%` },
      { label: "Month total", value: formatValue(total), muted: true },
    ],
  };
}

export function StackedBarChart({
  ariaLabel,
  years,
  segments,
  otherLabel,
  formatValue,
  focusYear,
  onFocusYearChange,
}: StackedBarChartProps) {
  const isControlled = onFocusYearChange !== undefined;

  const initialSelectedYears =
    years.length >= 2
      ? years.slice(-2).map((y) => y.year)
      : years.map((y) => y.year);

  const [internalSelectedYears, setInternalSelectedYears] =
    useState<number[]>(initialSelectedYears);
  const [activeTarget, setActiveTarget] = useState<{
    monthIndex: number;
    yearNum?: number;
    segmentKey?: string;
  } | null>(null);

  const selectedYears = isControlled
    ? focusYear !== null && focusYear !== undefined
      ? years.some((y) => y.year === focusYear - 1)
        ? [focusYear - 1, focusYear]
        : [focusYear]
      : initialSelectedYears
    : internalSelectedYears;

  const toggleYear = (yearNum: number) => {
    if (selectedYears.includes(yearNum)) {
      const minRequired = Math.min(2, years.length);
      if (selectedYears.length > minRequired) {
        setInternalSelectedYears(
          selectedYears.filter((y) => y !== yearNum).sort((a, b) => a - b),
        );
        setActiveTarget(null);
      }
    } else {
      setInternalSelectedYears(
        [...selectedYears, yearNum].sort((a, b) => a - b),
      );
      setActiveTarget(null);
    }
  };

  const activeYearsData = years.filter((y) => selectedYears.includes(y.year));
  const displayYears = activeYearsData.length > 0 ? activeYearsData : years.slice(-1);
  const primaryYear = displayYears.at(-1) ?? years.at(-1);
  const months = primaryYear?.months ?? [];
  const latestYear = years.at(-1);
  const latestAvailableMonth = latestYear?.months.filter((month) => !month.isFuture).at(-1);
  const firstFutureMonth = latestYear?.months.find((month) => month.isFuture);
  const lastCalendarMonth = latestYear?.months.at(-1);

  const maxTotal = Math.max(
    ...displayYears.flatMap((y) =>
      y.months.map((month) => monthTotal(month, segments)),
    ),
    1,
  );

  const plotWidth = WIDTH - LEFT - RIGHT;
  const plotHeight = HEIGHT - TOP - BOTTOM;
  const slotWidth = months.length > 0 ? plotWidth / months.length : plotWidth;

  const numActiveYears = displayYears.length;
  const maxClusterWidth = slotWidth * 0.78;
  const barGap = Math.max(2, Math.min(5, Math.floor(10 / numActiveYears)));
  const barWidth = Math.min(
    28,
    Math.max(6, (maxClusterWidth - (numActiveYears - 1) * barGap) / numActiveYears),
  );
  const clusterWidth = numActiveYears * barWidth + (numActiveYears - 1) * barGap;

  const centreFor = (index: number) =>
    getStackedMonthCentre(index, months.length);
  const heightFor = (value: number) => (value / maxTotal) * plotHeight;

  // Tooltip construction
  let tooltip: TooltipState | null = null;
  if (activeTarget !== null && months[activeTarget.monthIndex]) {
    const monthIndex = activeTarget.monthIndex;
    const activeMonthLabel = months[monthIndex].label;

    if (
      activeTarget.yearNum !== undefined &&
      activeTarget.segmentKey !== undefined
    ) {
      const targetYearObj = displayYears.find((y) => y.year === activeTarget.yearNum);
      const targetMonthData = targetYearObj?.months[monthIndex];

      if (targetMonthData) {
        tooltip = buildStackedSegmentTooltip({
          month: targetMonthData,
          monthIndex,
          monthCount: months.length,
          year: activeTarget.yearNum,
          segmentKey: activeTarget.segmentKey,
          segments,
          otherLabel,
          formatValue,
        });
      }
    } else {
      // Month-wide hover comparison across active years
      tooltip = {
        title: `${activeMonthLabel} (${selectedYears.join(" vs ")})`,
        anchor: months.length > 1 ? monthIndex / (months.length - 1) : 0.5,
        rows: displayYears.map((yearObj, idx) => {
          const mData = yearObj.months[monthIndex];
          const total = mData ? monthTotal(mData, segments) : 0;
          return {
            label: `${yearObj.year} Total`,
            value: !mData || mData.isFuture ? "Not available yet" : formatValue(total),
            muted: idx !== displayYears.length - 1,
          };
        }),
      };
    }
  }

  if (months.length === 0) {
    return <div className="empty-state">No data for this year.</div>;
  }

  return (
    <div className="stacked-bar-chart">
      <div
        aria-label="Years shown in the chart"
        className="year-toggle stacked-bar-chart__years"
        role="group"
      >
        {isControlled && (
          <button
            aria-pressed={focusYear === null}
            className={`year-toggle__button${focusYear === null ? " year-toggle__button--active" : ""}`}
            onClick={() => onFocusYearChange(null)}
            title="Show active reporting period"
            type="button"
          >
            Period
          </button>
        )}
        {years.map((year) => {
          const isSelected = isControlled
            ? focusYear === year.year
            : selectedYears.includes(year.year);
          return (
            <button
              aria-pressed={isSelected}
              className={`year-toggle__button${isSelected ? " year-toggle__button--active" : ""}`}
              key={year.year}
              onClick={() => {
                if (isControlled) {
                  onFocusYearChange(focusYear === year.year ? null : year.year);
                } else {
                  toggleYear(year.year);
                }
              }}
              type="button"
            >
              {year.year}
            </button>
          );
        })}
      </div>

      <div className="chart-plot">
        <svg
          aria-label={`${ariaLabel}, ${selectedYears.join(", ")}`}
          className={`stacked-bar-chart__svg${activeTarget !== null ? " stacked-bar-chart__svg--has-active" : ""}`}
          onMouseLeave={() => setActiveTarget(null)}
          role="group"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        >
          {[0.25, 0.5, 0.75, 1].map((fraction) => (
            <line
              className="chart-grid-line"
              key={fraction}
              x1={LEFT}
              x2={WIDTH - RIGHT}
              y1={TOP + plotHeight * (1 - fraction)}
              y2={TOP + plotHeight * (1 - fraction)}
            />
          ))}

          {/* Keep the broad month targets behind the marks. They provide a
              forgiving gap/touch target without blocking segment hover. */}
          {months.map((month, monthIndex) => (
            <rect
              aria-label={`${month.label}, compare ${selectedYears.join(" and ")}`}
              className="chart-hit"
              height={HEIGHT}
              key={`hit:${month.month}`}
              onClick={() =>
                setActiveTarget((prev) =>
                  prev?.monthIndex === monthIndex ? null : { monthIndex },
                )
              }
              onFocus={() => setActiveTarget({ monthIndex })}
              onMouseEnter={() =>
                setActiveTarget((prev) =>
                  prev?.monthIndex === monthIndex ? prev : { monthIndex },
                )
              }
              role="button"
              tabIndex={0}
              width={slotWidth}
              x={LEFT + slotWidth * monthIndex}
              y="0"
            />
          ))}

          {months.map((_, monthIndex) => {
            const clusterLeft = centreFor(monthIndex) - clusterWidth / 2;

            return (
              <g key={`month:${monthIndex}`}>
                {displayYears.map((yearObj, yearIndex) => {
                  const monthData = yearObj.months[monthIndex];
                  if (!monthData) return null;

                  const barX = clusterLeft + yearIndex * (barWidth + barGap);
                  let cursor = TOP + plotHeight;

                  const barSegments = segments.map((segment, segmentIndex) => {
                    const value = monthData.values[segment.key] ?? 0;
                    if (monthData.isFuture || value <= 0) return null;

                    const height = heightFor(value);
                    const total = monthTotal(monthData, segments);
                    const share = total > 0 ? (value / total) * 100 : 0;
                    cursor -= height;

                    const isHovered =
                      activeTarget !== null &&
                      activeTarget.monthIndex === monthIndex &&
                      (activeTarget.yearNum === undefined || activeTarget.yearNum === yearObj.year) &&
                      (activeTarget.segmentKey === undefined || activeTarget.segmentKey === segment.key);

                    const isDimmed =
                      activeTarget !== null && !isHovered;

                    return (
                      <rect
                        aria-label={`${segment.label}, ${monthData.label} ${yearObj.year}, sales ${formatValue(value)}, ${share.toFixed(1)}% of month`}
                        className={`stacked-bar-chart__segment stacked-bar-chart__segment--catalogue-${
                          segmentIndex % SERIES_COLOR_COUNT
                        }${isHovered ? " stacked-bar-chart__segment--active" : ""}${
                          isDimmed ? " stacked-bar-chart__segment--dimmed" : ""
                        }`}
                        height={Math.max(height, 0)}
                        key={segment.key}
                        onBlur={() => setActiveTarget(null)}
                        onClick={() =>
                          setActiveTarget({
                            monthIndex,
                            yearNum: yearObj.year,
                            segmentKey: segment.key,
                          })
                        }
                        onFocus={() =>
                          setActiveTarget({
                            monthIndex,
                            yearNum: yearObj.year,
                            segmentKey: segment.key,
                          })
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Escape") event.currentTarget.blur();
                        }}
                        onMouseEnter={() =>
                          setActiveTarget({
                            monthIndex,
                            yearNum: yearObj.year,
                            segmentKey: segment.key,
                          })
                        }
                        role={value > 0 ? "button" : undefined}
                        rx={2.5}
                        ry={2.5}
                        tabIndex={value > 0 ? 0 : undefined}
                        width={barWidth}
                        x={barX}
                        y={cursor}
                      />
                    );
                  });

                  if (!monthData.isFuture && monthData.other > 0) {
                    const height = heightFor(monthData.other);
                    const total = monthTotal(monthData, segments);
                    const share = total > 0 ? (monthData.other / total) * 100 : 0;
                    cursor -= height;

                    const isHovered =
                      activeTarget !== null &&
                      activeTarget.monthIndex === monthIndex &&
                      (activeTarget.yearNum === undefined || activeTarget.yearNum === yearObj.year) &&
                      (activeTarget.segmentKey === undefined || activeTarget.segmentKey === "other");

                    const isDimmed = activeTarget !== null && !isHovered;

                    barSegments.push(
                      <rect
                        aria-label={`${otherLabel}, ${monthData.label} ${yearObj.year}, sales ${formatValue(monthData.other)}, ${share.toFixed(1)}% of month`}
                        className={`stacked-bar-chart__segment stacked-bar-chart__segment--catalogue-other${
                          isHovered ? " stacked-bar-chart__segment--active" : ""
                        }${isDimmed ? " stacked-bar-chart__segment--dimmed" : ""}`}
                        height={Math.max(height, 0)}
                        key="other"
                        onBlur={() => setActiveTarget(null)}
                        onClick={() =>
                          setActiveTarget({
                            monthIndex,
                            yearNum: yearObj.year,
                            segmentKey: "other",
                          })
                        }
                        onFocus={() =>
                          setActiveTarget({
                            monthIndex,
                            yearNum: yearObj.year,
                            segmentKey: "other",
                          })
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Escape") event.currentTarget.blur();
                        }}
                        onMouseEnter={() =>
                          setActiveTarget({
                            monthIndex,
                            yearNum: yearObj.year,
                            segmentKey: "other",
                          })
                        }
                        role="button"
                        rx={2.5}
                        ry={2.5}
                        tabIndex={0}
                        width={barWidth}
                        x={barX}
                        y={cursor}
                      />,
                    );
                  }

                  return <g key={`bar:${yearObj.year}:${monthIndex}`}>{barSegments}</g>;
                })}
              </g>
            );
          })}

          <g aria-hidden="true" className="stacked-bar-chart__ticks">
            {months.map((month, monthIndex) => (
              <text
                key={`tick:${month.month}`}
                textAnchor="middle"
                x={centreFor(monthIndex)}
                y={HEIGHT - 6}
              >
                {month.label.slice(0, 3)}
              </text>
            ))}
          </g>
        </svg>
        <ChartTooltip state={tooltip} />
      </div>
      {latestYear && latestAvailableMonth && firstFutureMonth && lastCalendarMonth ? (
        <p className="semantic-note stacked-bar-chart__availability">
          {latestYear.year} data runs through{" "}
          {latestAvailableMonth.isPartial && latestAvailableMonth.throughDay
            ? `${latestAvailableMonth.throughDay} ${latestAvailableMonth.label}`
            : latestAvailableMonth.label}
          . {firstFutureMonth.label.slice(0, 3)}–{lastCalendarMonth.label.slice(0, 3)} are
          future months, not zero sales.
        </p>
      ) : null}
    </div>
  );
}
