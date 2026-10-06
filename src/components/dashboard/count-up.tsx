"use client";

import { useEffect, useRef, useState } from "react";

import { interpolateCount } from "@/lib/dashboard/count-up";

interface CountUpProps {
  /** The true value. The ticker always ends exactly here. */
  value: number;
  /** Formatter for the displayed string, including unit and currency. */
  format: (value: number) => string;
  durationMs?: number;
}

/**
 * Rolls a KPI number to its new value. Used for the snapshot figures so a
 * filter or timeframe change reads as a change rather than a silent swap.
 *
 * Deliberately not a dependency: `motion` would add ~34kb for one easing
 * curve. Geometry rule from AGENTS.md still applies — the ticker lands on the
 * exact value and never overshoots it.
 */
export function CountUp({ value, format, durationMs = 620 }: CountUpProps) {
  const [displayed, setDisplayed] = useState(value);
  const fromRef = useRef(value);

  useEffect(() => {
    const from = fromRef.current;
    fromRef.current = value;

    if (from === value) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDisplayed(value);
      return;
    }

    const start = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const progress = Math.min((now - start) / durationMs, 1);
      setDisplayed(interpolateCount(from, value, progress));
      if (progress < 1) frame = requestAnimationFrame(tick);
    });

    return () => cancelAnimationFrame(frame);
  }, [value, durationMs]);

  return <span className="count-up">{format(displayed)}</span>;
}
