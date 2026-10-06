"use client";

import { useEffect, useState } from "react";
import { VideoStageBackdrop } from "@/components/backgrounds/video-stage-backdrop";
import { BrandMark } from "@/components/dashboard/brand-mark";

const ROTATING_HEADLINES = [
  "Turn ad spend\ninto answers.",
  "Turn marketing data\ninto decisions.",
  "See what\ndrives growth.",
  "Know what’s working.\nControl what’s next.",
];

export function AuthStageVisual() {
  const [headlineIndex, setHeadlineIndex] = useState(0);
  const [displayedText, setDisplayedText] = useState(ROTATING_HEADLINES[0]);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    const currentFullText = ROTATING_HEADLINES[headlineIndex];
    let timeout: NodeJS.Timeout;

    if (!isDeleting) {
      if (displayedText.length < currentFullText.length) {
        const nextChar = currentFullText[displayedText.length];
        const typeDelay =
          nextChar === "\n"
            ? 220
            : nextChar === "." || nextChar === ","
              ? 180
              : 80;

        timeout = setTimeout(() => {
          setDisplayedText(currentFullText.slice(0, displayedText.length + 1));
        }, typeDelay);
      } else {
        timeout = setTimeout(() => {
          setIsDeleting(true);
        }, 3200);
      }
    } else if (displayedText.length > 0) {
      timeout = setTimeout(() => {
        setDisplayedText(currentFullText.slice(0, displayedText.length - 1));
      }, 40);
    } else {
      timeout = setTimeout(() => {
        setIsDeleting(false);
        setHeadlineIndex((previous) =>
          (previous + 1) % ROTATING_HEADLINES.length
        );
      }, 400);
    }

    return () => clearTimeout(timeout);
  }, [displayedText, isDeleting, headlineIndex]);

  return (
    <aside className="auth-stage">
      <div className="auth-stage__veil">
        <VideoStageBackdrop />
      </div>

      <div className="auth-stage__container">
        <div className="auth-stage__topmark">
          <BrandMark />
          <div className="auth-stage__badge">
            <span className="auth-stage__dot" />
            <span>Satulayar Unified Telemetry</span>
          </div>
        </div>

        <div className="auth-stage__copy">
          <div className="auth-stage__headline-box">
            <h1 className="auth-stage__headline">
              <span className="auth-stage__typing-text">{displayedText}</span>
              <span className="auth-stage__cursor" aria-hidden="true">_</span>
            </h1>
          </div>
          <p className="auth-stage__sub">
            Google Ads, Meta Ads, Bing Ads, and store performance for every brand you manage — read in one view.
          </p>
        </div>
      </div>
    </aside>
  );
}
