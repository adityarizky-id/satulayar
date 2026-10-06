"use client";

import { memo, useEffect, useRef, useState } from "react";

import type { DataQualityIssue, Platform } from "@/lib/dashboard/types";

export const TIMEZONE_MISMATCH_WARNING_CODE = "timezone-mismatch-bst" as const;

export const TIMEZONE_MISMATCH_DISCLAIMER_COPY =
  "Google (GMT) and Meta (BST) daily boundaries shift by 1 hour due to British Summer Time. Aggregated daily figures reflect this boundary alignment.";

export interface TimezoneMismatchDisclaimerProps {
  issues: readonly DataQualityIssue[];
  account?: { name: string; timezone: string } | null;
  platform?: Platform;
}

export function hasTimezoneMismatchWarning(
  issues: readonly Pick<DataQualityIssue, "code" | "severity">[],
): boolean {
  return issues.some(
    (issue) =>
      issue.code === TIMEZONE_MISMATCH_WARNING_CODE && issue.severity === "warning",
  );
}

function resolveTimezoneInfo(timeZone: string) {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      timeZoneName: "short",
    });
    const parts = formatter.formatToParts(now);
    const tzPart = parts.find((p) => p.type === "timeZoneName");
    const tzAbbr = tzPart?.value ?? "UTC";

    const city = timeZone.includes("/")
      ? timeZone.split("/").pop()?.replace(/_/g, " ") ?? timeZone
      : timeZone;

    const offsetFormatter = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      timeZoneName: "longOffset",
    });
    const offsetParts = offsetFormatter.formatToParts(now);
    const offsetPart = offsetParts.find((p) => p.type === "timeZoneName");
    const offsetStr = offsetPart?.value?.replace("GMT", "UTC") ?? tzAbbr;

    return { tzAbbr, city, offsetStr };
  } catch {
    return { tzAbbr: "UTC", city: timeZone, offsetStr: "UTC" };
  }
}

export const TimezoneMismatchDisclaimer = memo(
  function TimezoneMismatchDisclaimer({
    issues,
    account,
  }: TimezoneMismatchDisclaimerProps) {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    const hasWarning = hasTimezoneMismatchWarning(issues);

    const timeZone = account?.timezone ?? "Asia/Jakarta";
    const accountName = account?.name ?? "Kopi Senja Nusantara";
    const { tzAbbr, city, offsetStr } = resolveTimezoneInfo(timeZone);

    useEffect(() => {
      if (!isOpen) return;

      function handleKeyDown(event: KeyboardEvent) {
        if (event.key === "Escape") {
          setIsOpen(false);
        }
      }

      function handleClickOutside(event: MouseEvent) {
        if (
          containerRef.current &&
          !containerRef.current.contains(event.target as Node)
        ) {
          setIsOpen(false);
        }
      }

      document.addEventListener("keydown", handleKeyDown);
      document.addEventListener("mousedown", handleClickOutside);

      return () => {
        document.removeEventListener("keydown", handleKeyDown);
        document.removeEventListener("mousedown", handleClickOutside);
      };
    }, [isOpen]);

    // If no account is supplied and no warning exists, don't render (backwards compatibility).
    // Keep this after the hooks so the component's hook order stays stable.
    if (!hasWarning && !account) return null;

    return (
      <div
        className="topbar__boundary-container"
        ref={containerRef}
        data-warning-code={hasWarning ? TIMEZONE_MISMATCH_WARNING_CODE : undefined}
      >
        <button
          type="button"
          aria-expanded={isOpen}
          aria-haspopup="dialog"
          aria-label={`Reporting boundary: ${
            hasWarning ? "British Summer Time alignment GMT to BST" : `${city} ${tzAbbr}`
          }. Click to ${isOpen ? "close" : "view"} details.`}
          className={`topbar__boundary-pill ${
            hasWarning
              ? "topbar__boundary-pill--warning"
              : "topbar__boundary-pill--aligned"
          }`}
          onClick={() => setIsOpen((prev) => !prev)}
        >
          <span aria-hidden="true" className="topbar__boundary-icon">
            <svg fill="none" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="8.25" />
              <path d="M12 7.75v4.6l3.1 1.85" />
            </svg>
          </span>

          <span
            className={`status-dot status-dot--${
              hasWarning ? "info" : "positive"
            }`}
          />

          {hasWarning ? (
            <>
              <strong className="topbar__boundary-label">GMT → BST</strong>
              <small className="topbar__boundary-tag">+1h</small>
            </>
          ) : (
            <>
              <strong className="topbar__boundary-label">{city}</strong>
              <small className="topbar__boundary-tag">{tzAbbr}</small>
            </>
          )}
        </button>

        {isOpen && (
          <div
            aria-labelledby="timezone-mismatch-disclaimer-title"
            className="topbar__boundary-popover"
            role="dialog"
          >
            <div className="topbar__boundary-popover-header">
              <span className="timezone-disclaimer__eyebrow">Reporting boundary</span>
              <span
                className={`topbar__boundary-badge topbar__boundary-badge--${
                  hasWarning ? "warning" : "aligned"
                }`}
              >
                {hasWarning ? "Offset alignment" : "Synchronized"}
              </span>
            </div>

            <strong
              id="timezone-mismatch-disclaimer-title"
              className="topbar__boundary-popover-title"
            >
              {hasWarning
                ? "British Summer Time alignment"
                : `${accountName} boundary`}
            </strong>

            <p className="topbar__boundary-popover-desc">
              {hasWarning
                ? TIMEZONE_MISMATCH_DISCLAIMER_COPY
                : `Daily reporting is synchronized to ${timeZone} (${tzAbbr}). Daily cuts run from 00:00 to 23:59 in this market without cross-platform boundary shifts.`}
            </p>

            <div
              aria-hidden="true"
              className="timezone-disclaimer__boundary topbar__boundary-visual"
            >
              {hasWarning ? (
                <>
                  <span>GMT</span>
                  <span className="timezone-disclaimer__arrow">→</span>
                  <span>BST</span>
                  <small>+1h offset</small>
                </>
              ) : (
                <>
                  <span>UTC</span>
                  <span className="timezone-disclaimer__arrow">→</span>
                  <span>{tzAbbr}</span>
                  <small>{offsetStr}</small>
                </>
              )}
            </div>

            <div className="topbar__boundary-popover-footer">
              <span>
                Market: <strong>{city}</strong> ({timeZone})
              </span>
              <button
                type="button"
                className="topbar__boundary-popover-close"
                onClick={() => setIsOpen(false)}
                aria-label="Close reporting boundary details"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    );
  },
);
