"use client";

export type TooltipTone = "positive" | "warning" | "negative";

export interface TooltipRow {
  label: string;
  value: string;
  /** CSS class of the colour swatch shown next to the label. */
  swatch?: string;
  muted?: boolean;
  tone?: TooltipTone;
  annotation?: boolean;
}

export function tooltipToneForTrend(
  currentValue: number,
  previousValue: number,
): TooltipTone {
  if (!Number.isFinite(currentValue) || !Number.isFinite(previousValue)) {
    return "warning";
  }
  if (currentValue > previousValue) return "positive";
  if (currentValue < previousValue) return "negative";
  return "warning";
}

export interface TooltipState {
  title: string;
  rows: TooltipRow[];
  /** Horizontal anchor as a share of the plot width, 0 to 1. */
  anchor: number;
}

export function ChartTooltip({ state }: { state: TooltipState | null }) {
  if (!state) return null;

  // Keep the bubble inside the panel: it flips side once it passes the middle.
  const isRightHalf = state.anchor > 0.5;

  return (
    <div
      aria-hidden="true"
      className={`chart-tooltip ${
        isRightHalf ? "chart-tooltip--left" : "chart-tooltip--right"
      }`}
      style={{ left: `${Math.min(Math.max(state.anchor, 0) * 100, 100)}%` }}
    >
      <strong>{state.title}</strong>
      <ul>
        {state.rows.map((row, index) => (
          <li
            className={row.annotation ? "chart-tooltip__annotation" : undefined}
            key={`${row.label}:${row.value}:${index}`}
          >
            <span>
              {row.swatch && <i className={`legend-dot ${row.swatch}`} />}
              {row.label}
            </span>
            <b
              className={
                [
                  row.muted ? "chart-tooltip__muted" : "",
                  row.tone ? `chart-tooltip__value--${row.tone}` : "",
                ]
                  .filter(Boolean)
                  .join(" ") || undefined
              }
            >
              {row.value}
            </b>
          </li>
        ))}
      </ul>
    </div>
  );
}
