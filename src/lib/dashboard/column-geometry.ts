/**
 * Deterministic geometry for `ColumnChart`.
 *
 * The chart draws its marks inside an SVG viewBox but renders the category
 * labels, year bands, and value ticks as HTML, so those keep their real font
 * size instead of being shrunk along with the viewBox. That split only works
 * if both sides agree on where the plot area starts and ends. Every offset
 * therefore lives here and is unit tested, rather than being restated in CSS
 * where it silently drifts: the category labels used to span the full chart
 * width while the columns sat inside a 26px inset, so every label was up to a
 * third of a slot away from the column it named.
 */

export const COLUMN_WIDTH = 760;
export const COLUMN_HEIGHT = 240;
export const COLUMN_PADDING = 26;

/** Gridline positions as a share of the plot height. 0 is the axis maximum. */
export const COLUMN_GRID_FRACTIONS = [0, 0.25, 0.5, 0.75, 1] as const;

export function plotWidth(): number {
  return COLUMN_WIDTH - COLUMN_PADDING * 2;
}

export function plotHeight(height: number = COLUMN_HEIGHT): number {
  return height - COLUMN_PADDING * 2;
}

export function slotWidth(count: number): number {
  return count <= 0 ? plotWidth() : plotWidth() / count;
}

export function slotCentre(index: number, count: number): number {
  return COLUMN_PADDING + slotWidth(count) * (index + 0.5);
}

/**
 * Horizontal inset of the plot area, as a percentage of the full chart width.
 * The HTML label track uses it as padding so a label lands under its column.
 */
export const COLUMN_AXIS_INSET_PERCENT = (COLUMN_PADDING / COLUMN_WIDTH) * 100;

/** Tooltip anchor as a share of the full chart width, matching the column centre. */
export function tooltipAnchor(index: number, count: number): number {
  if (count <= 0) return 0.5;
  return slotCentre(index, count) / COLUMN_WIDTH;
}

/**
 * Vertical position of a gridline as a percentage of the full chart height.
 * The SVG scales uniformly inside its box, so a share of the viewBox height is
 * the same share of the rendered box, and an absolutely positioned HTML tick
 * label placed at this offset stays on its gridline at every width.
 */
export function gridLinePercent(
  fraction: number,
  height: number = COLUMN_HEIGHT,
): number {
  return ((COLUMN_PADDING + plotHeight(height) * fraction) / height) * 100;
}

/** The value a gridline stands for, given the axis maximum. */
export function gridLineValue(fraction: number, axisMax: number): number {
  return axisMax * (1 - fraction);
}

/**
 * Round an axis maximum up to 1, 2, or 5 times a power of ten.
 *
 * A labelled axis is only worth having if the labels are readable, and ticks
 * derived from a raw maximum read as "47,382 / 35,537 / 23,691". Quartering a
 * 1/2/5 step always lands on figures a reader can hold in their head.
 */
export function niceAxisMax(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalised = value / magnitude;
  const step = [1, 2, 5, 10].find((candidate) => normalised <= candidate) ?? 10;
  return step * magnitude;
}

export function barWidth(count: number, seriesCount: number): number {
  return Math.max(4, (slotWidth(count) * 0.62) / Math.max(seriesCount, 1));
}

export interface BarRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Rectangle for one bar. The height is clamped to the plot but never padded to
 * a minimum: a zero has to end at the baseline with no height, because a bar
 * given a floor of one pixel reads as a small non-zero value. The component
 * draws an explicit zero tick instead, which cannot be mistaken for magnitude.
 */
export function barRect(
  value: number,
  axisMax: number,
  index: number,
  seriesIndex: number,
  count: number,
  seriesCount: number,
  height: number = COLUMN_HEIGHT,
): BarRect {
  const width = barWidth(count, seriesCount);
  const groupWidth = width * seriesCount;
  const drawn =
    axisMax <= 0
      ? 0
      : Math.max(0, Math.min(value / axisMax, 1)) * plotHeight(height);

  return {
    x: slotCentre(index, count) - groupWidth / 2 + seriesIndex * width,
    y: height - COLUMN_PADDING - drawn,
    width,
    height: drawn,
  };
}

export interface AxisBand {
  label: string;
  /** How many consecutive categories the band covers. */
  span: number;
}

export interface AxisBandLayout {
  label: string;
  leftPercent: number;
  widthPercent: number;
  /** Slot index the band starts at, for drawing the divider inside the SVG. */
  startSlot: number;
}

/**
 * Lay out the bands drawn under the category labels, e.g. the year a run of
 * months belongs to. Percentages are shares of the plot track, which already
 * carries `COLUMN_AXIS_INSET_PERCENT`, so they need no further correction.
 *
 * A band is trimmed to the categories that actually exist and dropped once
 * they run out, so a stale band definition cannot push a label off the axis.
 */
export function layoutAxisBands(
  bands: readonly AxisBand[],
  count: number,
): AxisBandLayout[] {
  if (count <= 0) return [];

  const layout: AxisBandLayout[] = [];
  let consumed = 0;

  for (const band of bands) {
    const span = Math.min(Math.max(band.span, 0), count - consumed);
    if (span <= 0) continue;

    layout.push({
      label: band.label,
      leftPercent: (consumed / count) * 100,
      widthPercent: (span / count) * 100,
      startSlot: consumed,
    });
    consumed += span;
  }

  return layout;
}

/** X position inside the viewBox of the divider opening a band. */
export function bandDividerX(startSlot: number, count: number): number {
  return COLUMN_PADDING + slotWidth(count) * startSlot;
}
