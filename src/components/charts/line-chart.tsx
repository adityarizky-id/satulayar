"use client";

import { useEffect, useId, useRef, useState } from "react";

import { ChartTooltip, type TooltipState } from "@/components/charts/chart-tooltip";
import {
  smoothAreaPath,
  smoothLinePath,
  splitLineSegments,
} from "@/components/charts/smooth-line";

export interface LineSeries {
  key: string;
  label: string;
  /** CSS modifier suffix, e.g. "meta" renders chart-line--meta. */
  variant: string;
  /** Series with the same key share a quantitative scale. */
  scaleKey?: string;
  /** Context series render behind and slightly quieter than the foreground. */
  depth?: "foreground" | "context";
  /** Filled areas are useful for magnitude, but optional for multi-unit plots. */
  showArea?: boolean;
  values: (number | null)[];
}

export interface LineChartAnnotation {
  key: string;
  /** Must match one value in `labels`. */
  label: string;
  title: string;
  summary: string;
  variant?: "google" | "meta" | "cross";
}

export interface LineChartProps {
  ariaLabel: string;
  labels: string[];
  series: LineSeries[];
  formatValue: (value: number, seriesKey: string) => string;
  formatLabel?: (label: string) => string;
  focusedSeriesKey?: string | null;
  footerLeft?: string;
  footerRight?: string;
  height?: number;
  width?: number;
  /** Recomputes the plot geometry from its rendered CSS box. */
  fitContainer?: boolean;
  showLegend?: boolean;
  annotations?: LineChartAnnotation[];
  /** Labels the independent quantitative scales used by the visible series. */
  scaleLabels?: { key: string; label: string }[];
  axisLabels?: { left: string; right: string };
}

const DEFAULT_WIDTH = 720;
const DEFAULT_HEIGHT = 210;
const PADDING = 24;

export function LineChart({
  ariaLabel,
  labels,
  series,
  formatValue,
  formatLabel,
  focusedSeriesKey,
  footerLeft,
  footerRight,
  height = DEFAULT_HEIGHT,
  width = DEFAULT_WIDTH,
  fitContainer = false,
  showLegend = true,
  annotations = [],
  scaleLabels = [],
}: LineChartProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const chartRef = useRef<SVGSVGElement>(null);
  const [containerSize, setContainerSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const instructionsId = useId();
  const gradientIdPrefix = `trend-area-${useId().replace(/:/g, "")}`;
  // Picking a series out of the legend dims the rest, the same rule the bar
  // and ring charts follow: the thing under the cursor is the thing that pops.
  const [internalFocusKey, setInternalFocusKey] = useState<string | null>(null);
  const focusKey =
    focusedSeriesKey === undefined ? internalFocusKey : focusedSeriesKey;
  const chartWidth = fitContainer && containerSize ? containerSize.width : width;
  const chartHeight = fitContainer && containerSize ? containerSize.height : height;

  useEffect(() => {
    const chart = chartRef.current;
    if (!fitContainer || !chart || typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(([entry]) => {
      const nextWidth = Math.round(entry?.contentRect.width ?? 0);
      const nextHeight = Math.round(entry?.contentRect.height ?? 0);
      if (nextWidth <= 0 || nextHeight <= 0) return;

      setContainerSize((current) =>
        current?.width === nextWidth && current.height === nextHeight
          ? current
          : { width: nextWidth, height: nextHeight },
      );
    });

    observer.observe(chart);
    return () => observer.disconnect();
  }, [fitContainer]);

  const scaleMaxima = new Map<string, number>();
  for (const item of series) {
    const scaleKey = item.scaleKey ?? "shared";
    const numericValues = item.values.filter(
      (value): value is number => value !== null,
    );
    scaleMaxima.set(
      scaleKey,
      Math.max(scaleMaxima.get(scaleKey) ?? 0, ...numericValues, 0.000_001),
    );
  }
  const step =
    labels.length > 1
      ? (chartWidth - PADDING * 2) / (labels.length - 1)
      : 0;

  function xFor(index: number) {
    return labels.length > 1 ? PADDING + index * step : chartWidth / 2;
  }

  function yFor(value: number, scaleKey = "shared") {
    const maxValue = scaleMaxima.get(scaleKey) ?? 0.000_001;
    return (
      chartHeight -
      PADDING -
      (value / maxValue) * (chartHeight - PADDING * 2)
    );
  }

  const plottedSeries = series.map((item, seriesIndex) => ({
    ...item,
    gradientId: `${gradientIdPrefix}-${seriesIndex}`,
    segments: splitLineSegments(
      item.values.map((value, index) =>
        value === null
          ? null
          : { x: xFor(index), y: yFor(value, item.scaleKey) },
      ),
    ),
  }));
  const depthOrderedSeries = [...plottedSeries].sort((left, right) =>
    left.depth === right.depth ? 0 : left.depth === "context" ? -1 : 1,
  );
  const annotationGroups = labels
    .map((label, index) => ({
      index,
      label,
      items: annotations.filter((annotation) => annotation.label === label),
    }))
    .filter((group) => group.items.length > 0);
  const activeAnnotations =
    activeIndex === null
      ? []
      : annotationGroups.find((group) => group.index === activeIndex)?.items ??
        [];

  const tooltip: TooltipState | null =
    activeIndex === null
      ? null
      : {
          title: formatLabel
            ? formatLabel(labels[activeIndex] ?? "")
            : labels[activeIndex] ?? "",
          anchor: labels.length > 1 ? activeIndex / (labels.length - 1) : 0.5,
          rows: [
            ...series.map((item) => {
              const value = item.values[activeIndex];
              return {
                label: item.label,
                value:
                  value === null || value === undefined
                    ? "N/A"
                    : formatValue(value, item.key),
                swatch: `legend-dot--${item.variant}`,
                muted: value === null || value === undefined,
              };
            }),
            ...activeAnnotations.map((annotation) => ({
              label: `Worklog · ${annotation.title}`,
              value: annotation.summary,
              annotation: true,
              swatch: `worklog-swatch--${annotation.variant ?? "cross"}`,
            })),
          ],
        };
  const screenReaderSummary = tooltip
    ? `${tooltip.title}. ${tooltip.rows
        .map((row) => `${row.label}: ${row.value}`)
        .join(". ")}.`
    : "";

  return (
    <div
      className={`chart-shell chart-shell--interactive${
        focusKey === null ? "" : " chart-shell--series-focus"
      }`}
    >
      {showLegend && (
        <div
          className={`chart-legend${
            focusKey === null ? "" : " chart-legend--focused"
          }`}
        >
          {series.map((item) => (
            <button
              className={
                focusKey === item.key ? "chart-legend__item--focus" : undefined
              }
              key={item.key}
              onBlur={() => setInternalFocusKey(null)}
              onFocus={() => setInternalFocusKey(item.key)}
              onMouseEnter={() => setInternalFocusKey(item.key)}
              onMouseLeave={() => setInternalFocusKey(null)}
              type="button"
            >
              <i className={`legend-dot legend-dot--${item.variant}`} />
              {item.label}
            </button>
          ))}
        </div>
      )}
      {scaleLabels.length > 0 && (
        <div
          aria-label="Independent chart scales"
          className="chart-scale-labels"
          role="list"
        >
          {scaleLabels.map((scale) => (
            <span key={scale.key} role="listitem">
              {scale.label}
            </span>
          ))}
        </div>
      )}
      <div className="chart-plot">
        <p className="visually-hidden" id={instructionsId}>
          Use the left and right arrow keys to inspect each closed day. On a
          touch screen, tap a date position in the chart. Values are announced
          after the selected date changes. Worklog pins identify approved
          interventions on their execution date and do not establish causality.
        </p>
        <svg
          aria-describedby={instructionsId}
          aria-label={ariaLabel}
          className={`trend-chart${
            fitContainer ? " trend-chart--fit-container" : ""
          }`}
          onBlur={() => setActiveIndex(null)}
          onFocus={() => {
            if (labels.length > 0) {
              setActiveIndex((current) => current ?? 0);
            }
          }}
          onKeyDown={(event) => {
            if (
              labels.length === 0 ||
              (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
            ) {
              return;
            }
            event.preventDefault();
            setActiveIndex((current) => {
              const index = current ?? 0;
              return event.key === "ArrowLeft"
                ? Math.max(0, index - 1)
                : Math.min(labels.length - 1, index + 1);
            });
          }}
          onMouseLeave={() => setActiveIndex(null)}
          role="group"
          ref={chartRef}
          tabIndex={0}
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          preserveAspectRatio={fitContainer ? "none" : undefined}
        >
          <defs>
            {plottedSeries.map((item) => (
              <linearGradient
                className={`chart-area-gradient chart-area-gradient--${item.variant}`}
                gradientUnits="userSpaceOnUse"
                id={item.gradientId}
                key={item.gradientId}
                x1="0"
                x2="0"
                y1={PADDING}
                y2={chartHeight - PADDING}
              >
                <stop className="chart-area-stop chart-area-stop--peak" offset="0%" />
                <stop className="chart-area-stop chart-area-stop--body" offset="58%" />
                <stop className="chart-area-stop chart-area-stop--base" offset="100%" />
              </linearGradient>
            ))}
          </defs>

          {[0.25, 0.5, 0.75].map((fraction) => (
            <line
              className="chart-grid-line"
              key={fraction}
              x1={PADDING}
              x2={chartWidth - PADDING}
              y1={PADDING + (chartHeight - PADDING * 2) * fraction}
              y2={PADDING + (chartHeight - PADDING * 2) * fraction}
            />
          ))}

          {depthOrderedSeries.map((item) =>
            item.showArea === false
              ? null
              : item.segments.map((points, segmentIndex) => (
                  <path
                    aria-hidden="true"
                    className={`chart-area chart-area--${item.variant}${
                      focusKey === item.key ? " chart-area--focus" : ""
                    }${item.depth === "context" ? " chart-area--context" : ""}`}
                    d={smoothAreaPath(points, chartHeight - PADDING)}
                    fill={`url(#${item.gradientId})`}
                    key={`${item.key}:area:${segmentIndex}`}
                  />
                )),
          )}

          {activeIndex !== null && (
            <line
              className="chart-hover-line"
              x1={xFor(activeIndex)}
              x2={xFor(activeIndex)}
              y1={PADDING - 6}
              y2={chartHeight - PADDING}
            />
          )}

          {depthOrderedSeries.map((item) =>
            item.segments.map((points, segmentIndex) => (
              <path
                className={`chart-line chart-line--${item.variant}${
                  focusKey === item.key ? " chart-line--focus" : ""
                }${item.depth === "context" ? " chart-line--context" : ""}`}
                d={smoothLinePath(points)}
                fill="none"
                key={`${item.key}:line:${segmentIndex}`}
              />
            )),
          )}

          {activeIndex !== null &&
            series.map((item) => {
              const value = item.values[activeIndex];
              if (value === null || value === undefined) return null;
              return (
                <circle
                  className={`chart-marker chart-marker--${item.variant}${
                    focusKey === item.key ? " chart-marker--focus" : ""
                  }${item.depth === "context" ? " chart-marker--context" : ""}`}
                  cx={xFor(activeIndex)}
                  cy={yFor(value, item.scaleKey)}
                  key={item.key}
                  r="4"
                />
              );
            })}

          {labels.map((label, index) => (
            <rect
              className="chart-hit"
              height={chartHeight}
              key={label}
              onMouseEnter={() => setActiveIndex(index)}
              onPointerDown={() => setActiveIndex(index)}
              width={Math.max(step, 6)}
              x={xFor(index) - Math.max(step, 6) / 2}
              y={0}
            />
          ))}

          {annotationGroups.map((group) => {
            const variants = new Set(
              group.items.map((item) => item.variant ?? "cross"),
            );
            const variant =
              variants.size === 1
                ? (group.items[0]?.variant ?? "cross")
                : "cross";
            const label = group.items
              .map((item) => `${item.title}: ${item.summary}`)
              .join(". ");

            return (
              <g
                aria-label={`${formatLabel ? formatLabel(group.label) : group.label}. Worklog: ${label}`}
                className={`chart-annotation chart-annotation--${variant}`}
                key={group.label}
                onFocus={() => setActiveIndex(group.index)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setActiveIndex(group.index);
                  }
                }}
                onMouseEnter={() => setActiveIndex(group.index)}
                onPointerDown={() => setActiveIndex(group.index)}
                role="button"
                tabIndex={0}
              >
                <line
                  aria-hidden="true"
                  className="chart-annotation__stem"
                  x1={xFor(group.index)}
                  x2={xFor(group.index)}
                  y1={PADDING - 8}
                  y2={PADDING + 11}
                />
                <circle
                  aria-hidden="true"
                  className="chart-annotation__pin"
                  cx={xFor(group.index)}
                  cy={PADDING - 8}
                  r="5"
                />
                {group.items.length > 1 && (
                  <text
                    aria-hidden="true"
                    className="chart-annotation__count"
                    textAnchor="middle"
                    x={xFor(group.index)}
                    y={PADDING - 6}
                  >
                    {group.items.length}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        <ChartTooltip state={tooltip} />
        <p aria-atomic="true" aria-live="polite" className="visually-hidden">
          {screenReaderSummary}
        </p>
      </div>
      <div className="chart-axis">
        <span>{footerLeft ?? labels[0] ?? "—"}</span>
        <span>{footerRight ?? labels.at(-1) ?? "—"}</span>
      </div>
    </div>
  );
}
