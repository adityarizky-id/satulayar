/** Easing for KPI tickers: fast start, gentle settle, no overshoot. */
export function easeOutCubic(progress: number): number {
  return 1 - (1 - progress) ** 3;
}

/**
 * Value to display part-way through a KPI ticker.
 *
 * The final frame returns `to` exactly. AGENTS.md forbids motion that
 * temporarily depicts a value the data does not support, so the ticker must
 * never overshoot and must land on the true figure rather than a rounded
 * approximation of it.
 */
export function interpolateCount(
  from: number,
  to: number,
  progress: number,
): number {
  if (progress <= 0) return from;
  if (progress >= 1) return to;
  return from + (to - from) * easeOutCubic(progress);
}
