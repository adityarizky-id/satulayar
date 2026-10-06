"use client";

import { useState } from "react";

export type RingTone =
  | "on-track"
  | "ahead-of-plan"
  | "underspending"
  | "overspending"
  | "unavailable";

const RADIUS = 46;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const OVERFLOW_RADIUS = 56;
const OVERFLOW_CIRCUMFERENCE = 2 * Math.PI * OVERFLOW_RADIUS;
const PROGRESS_CAP_LENGTH = 9;
/** SVG circles begin at 3 o'clock; -90 degrees moves 0% to 12 o'clock. */
const RING_START_ROTATION = -90;

export interface RingGeometry {
  safeProgress: number;
  sweepRatio: number;
  sweepDegrees: number;
  overflowRatio: number;
  overflowSweepRatio: number;
  overflowSweepDegrees: number;
  progressMarkerDegrees: number;
  isComplete: boolean;
  isOverflowComplete: boolean;
  isOverBudget: boolean;
}

export function calculateRingGeometry(progress: number): RingGeometry {
  const safeProgress = Number.isFinite(progress) ? Math.max(progress, 0) : 0;
  const sweepRatio = Math.min(safeProgress, 1);
  const overflowRatio = Math.max(safeProgress - 1, 0);
  const overflowSweepRatio = Math.min(overflowRatio, 1);
  const markerTurn = safeProgress % 1;
  const progressMarkerDegrees =
    safeProgress <= 0 ? 0 : markerTurn === 0 ? 360 : markerTurn * 360;

  return {
    safeProgress,
    sweepRatio,
    sweepDegrees: sweepRatio * 360,
    overflowRatio,
    overflowSweepRatio,
    overflowSweepDegrees: overflowSweepRatio * 360,
    progressMarkerDegrees,
    isComplete: sweepRatio === 1,
    isOverflowComplete: overflowSweepRatio === 1,
    isOverBudget: safeProgress > 1,
  };
}

export interface ProgressRingProps {
  /** 0 to 1 fills the ring. Above 1 means over budget. */
  progress: number;
  /** Hide the endpoint when no usable budget exists. */
  showProgressMarker?: boolean;
  tone: RingTone;
  centreValue: string;
  /**
   * Optional caption under the figure. Omit it where the ring sits beside a
   * facts list that already names what the percentage measures: at this
   * diameter a caption longer than about twelve characters runs past the
   * stroke and collides with the text next to it.
   */
  centreLabel?: string;
  ariaLabel: string;
}

/**
 * One number, drawn clockwise from 12 o'clock. The rounded black cap follows
 * the current spent endpoint. Above 100%, it moves to the outer overflow lap.
 */
export function ProgressRing({
  progress,
  showProgressMarker = true,
  tone,
  centreValue,
  centreLabel,
  ariaLabel,
}: ProgressRingProps) {
  const [hovered, setHovered] = useState(false);

  const geometry = calculateRingGeometry(progress);
  const dash = geometry.sweepRatio * CIRCUMFERENCE;
  const overflowDash = geometry.overflowSweepRatio * OVERFLOW_CIRCUMFERENCE;
  const markerRadius = geometry.isOverBudget ? OVERFLOW_RADIUS : RADIUS;
  const markerCircumference = geometry.isOverBudget
    ? OVERFLOW_CIRCUMFERENCE
    : CIRCUMFERENCE;
  const markerDistance =
    (geometry.progressMarkerDegrees / 360) * markerCircumference;
  const markerStart =
    ((markerDistance - PROGRESS_CAP_LENGTH / 2) % markerCircumference +
      markerCircumference) %
    markerCircumference;
  const overflowPercentage = geometry.overflowRatio * 100;
  const overflowLabel =
    overflowPercentage < 10
      ? overflowPercentage.toFixed(1).replace(/\.0$/, "")
      : Math.round(overflowPercentage).toString();

  return (
    <div
      className={`ring ring--${tone}${hovered ? " ring--hover" : ""}`}
      onBlur={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      tabIndex={0}
    >
      <svg aria-label={ariaLabel} role="img" viewBox="0 0 120 120">
        <circle className="ring__track" cx="60" cy="60" r={RADIUS} />
        {dash > 0 && (
          <circle
            className={`ring__value${
              geometry.isComplete ? " ring__value--complete" : ""
            }`}
            cx="60"
            cy="60"
            r={RADIUS}
            strokeDasharray={`${dash} ${Math.max(CIRCUMFERENCE - dash, 0)}`}
            transform={`rotate(${RING_START_ROTATION} 60 60)`}
          />
        )}
        {geometry.isOverBudget && (
          <>
            <circle
              className="ring__overflow-track"
              cx="60"
              cy="60"
              r={OVERFLOW_RADIUS}
            />
            <circle
              className={`ring__overflow${geometry.isOverflowComplete ? " ring__overflow--complete" : ""}`}
              cx="60"
              cy="60"
              r={OVERFLOW_RADIUS}
              strokeDasharray={`${overflowDash} ${Math.max(
                OVERFLOW_CIRCUMFERENCE - overflowDash,
                0,
              )}`}
              transform={`rotate(${RING_START_ROTATION} 60 60)`}
            >
                {/* One string child: an SVG <title> split into several text
                  nodes serialises differently on the server and fails to
                  hydrate. */}
              <title>{`${overflowLabel}% over budget`}</title>
            </circle>
          </>
        )}
        {showProgressMarker && geometry.safeProgress > 0 && (
          <circle
            className="ring__progress-cap"
            cx="60"
            cy="60"
            r={markerRadius}
            strokeDasharray={`${PROGRESS_CAP_LENGTH} ${Math.max(
              markerCircumference - PROGRESS_CAP_LENGTH,
              0,
            )}`}
            strokeDashoffset={-markerStart}
            transform={`rotate(${RING_START_ROTATION} 60 60)`}
          >
            <title>{`Current spend: ${(geometry.safeProgress * 100).toFixed(
              1,
            )}%`}</title>
          </circle>
        )}
      </svg>
      {geometry.isOverBudget && (
        <div
          aria-label={`${overflowLabel}% over budget`}
          className="ring__overflow-badge"
          title={`${overflowLabel}% over budget`}
        >
          +{overflowLabel}%
        </div>
      )}
      <div className="ring__centre">
        <strong>{centreValue}</strong>
        {centreLabel ? <span>{centreLabel}</span> : null}
      </div>
    </div>
  );
}
