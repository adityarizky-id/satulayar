export interface LinePoint {
  x: number;
  y: number;
}

/**
 * 0 draws the same straight joints a raw polyline would (the "kaku" look).
 * 1 is a full Catmull-Rom curve. The per-segment clamp in smoothLinePath
 * still holds even at this level, so the curve still can't bow past the two
 * real values it connects.
 */
export const CHART_LINE_TENSION = 0.45;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * A Catmull-Rom-derived cubic Bezier path through `points`, the standard
 * technique for turning a jagged polyline into a smooth line chart (Chart.js
 * calls the same knob `tension`; D3's `curveCardinal` is the same formula
 * with the direction of the 0–1 scale flipped).
 *
 * Each segment's control points are clamped to that segment's own y-range,
 * so raising the tension softens the joints without ever bowing the curve
 * past the two real values it connects — unlike plain Catmull-Rom, which
 * overshoots around a sharp spike or dip.
 */
export function smoothLinePath(
  points: readonly LinePoint[],
  tension: number = CHART_LINE_TENSION,
): string {
  if (points.length === 0) return "";

  const [first, ...rest] = points;
  if (!first) return "";
  if (rest.length === 0 || tension <= 0) {
    return points
      .map((point, index) =>
        `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`,
      )
      .join(" ");
  }

  let path = `M ${first.x.toFixed(2)} ${first.y.toFixed(2)}`;

  for (let index = 0; index < points.length - 1; index += 1) {
    const p1 = points[index] as LinePoint;
    const p2 = points[index + 1] as LinePoint;
    const p0 = points[index - 1] ?? p1;
    const p3 = points[index + 2] ?? p2;
    const segmentMinY = Math.min(p1.y, p2.y);
    const segmentMaxY = Math.max(p1.y, p2.y);

    const controlOneX = p1.x + ((p2.x - p0.x) * tension) / 6;
    const controlOneY = clamp(
      p1.y + ((p2.y - p0.y) * tension) / 6,
      segmentMinY,
      segmentMaxY,
    );
    const controlTwoX = p2.x - ((p3.x - p1.x) * tension) / 6;
    const controlTwoY = clamp(
      p2.y - ((p3.y - p1.y) * tension) / 6,
      segmentMinY,
      segmentMaxY,
    );

    path += ` C ${controlOneX.toFixed(2)} ${controlOneY.toFixed(2)}, ${controlTwoX.toFixed(2)} ${controlTwoY.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }

  return path;
}

/**
 * Close a smoothed line against the quantitative zero baseline. This keeps
 * the line as the precise mark while the translucent area adds magnitude and
 * depth without changing the represented values.
 */
export function smoothAreaPath(
  points: readonly LinePoint[],
  baseline: number,
  tension: number = CHART_LINE_TENSION,
): string {
  if (points.length === 0) return "";

  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) return "";

  return `${smoothLinePath(points, tension)} L ${last.x.toFixed(2)} ${baseline.toFixed(2)} L ${first.x.toFixed(2)} ${baseline.toFixed(2)} Z`;
}

/** Missing observations break both the line and its area instead of being
 * bridged or rendered as zero. */
export function splitLineSegments(
  points: readonly (LinePoint | null)[],
): LinePoint[][] {
  const segments: LinePoint[][] = [];
  let segment: LinePoint[] = [];

  for (const point of points) {
    if (point) {
      segment.push(point);
      continue;
    }

    if (segment.length > 0) {
      segments.push(segment);
      segment = [];
    }
  }

  if (segment.length > 0) segments.push(segment);
  return segments;
}
