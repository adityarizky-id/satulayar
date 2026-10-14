"use client";

import { useState } from "react";

import type {
  AdvisoryBrief,
  AdvisoryObservation,
} from "@/lib/dashboard/advisory";
import { LightbulbIcon } from "@/components/dashboard/icons";

const SEVERITY_LABEL: Record<string, string> = {
  good: "clear",
  watch: "watch",
  act: "act now",
};

const EFFORT_LABEL: Record<string, string> = {
  quick: "quick",
  standard: "standard",
  project: "project",
};

const SEVERITY_RANK: Record<string, number> = { act: 0, watch: 1, good: 2 };

/**
 * Observations that belong to the host section come first, then the rest, so
 * the strip reads as this card's own note rather than a page-wide digest.
 */
function orderForScope(
  observations: readonly AdvisoryObservation[],
  scope: string,
): AdvisoryObservation[] {
  return [...observations].toSorted((left, right) => {
    const own = Number(right.evidence === scope) - Number(left.evidence === scope);
    if (own !== 0) return own;
    return (
      (SEVERITY_RANK[left.severity] ?? 3) - (SEVERITY_RANK[right.severity] ?? 3)
    );
  });
}

/**
 * Insight and recommendation, attached to the card it is about instead of
 * standing as its own section. Collapsed it costs a single row; open it grows
 * to a fixed height and scrolls inside itself, so a long brief can never push
 * the metrics off the screen.
 *
 * This is the first host. Any other card can take the same strip by passing
 * its own `scope`, which is the whole point of shaping it this way.
 */
export function InsightAttachment({
  brief,
  scope,
}: {
  brief: AdvisoryBrief;
  scope: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const observations = orderForScope(brief.observations, scope);
  const lead = observations[0];
  const actCount = observations.filter((item) => item.severity === "act").length;
  const scopeSlug = scope.replace(/\W+/g, "-").toLowerCase();
  const panelId = `advisory-${scopeSlug}`;

  return (
    <section
      aria-label={`Insight and recommendation for ${scope}`}
      className={`insight-strip${isOpen ? " insight-strip--open" : ""}`}
      // One strip per host card, so the id carries the scope to stay unique.
      id={`insight-${scopeSlug}`}
    >
      <button
        aria-controls={panelId}
        aria-expanded={isOpen}
        className="insight-strip__bar"
        onClick={() => setIsOpen((current) => !current)}
        type="button"
      >
        <span className="insight-strip__title">
          <LightbulbIcon className="insight-strip__icon" />
          <span>Insight &amp; recommendation</span>
        </span>
        <span className="insight-strip__lead">
          {lead ? lead.headline : "Nothing to flag for this period."}
        </span>
        <span className="insight-strip__counts">
          {actCount > 0 && (
            <em className="severity-chip severity-chip--act">{actCount} to act</em>
          )}
          <span>
            {observations.length} insight{observations.length === 1 ? "" : "s"} ·{" "}
            {brief.actions.length} action{brief.actions.length === 1 ? "" : "s"}
          </span>
          <span aria-hidden="true" className="insight-strip__caret" />
        </span>
      </button>

      {isOpen && (
        <div className="insight-strip__panel" id={panelId}>
          <article className="insight-column">
            <h3>Insight</h3>
            <ul className="advisory-list">
              {observations.map((observation) => (
                <li key={observation.id}>
                  <span
                    className={`severity-chip severity-chip--${observation.severity}`}
                  >
                    {SEVERITY_LABEL[observation.severity] ?? observation.severity}
                  </span>
                  <div>
                    <strong>{observation.headline}</strong>
                    <p>{observation.detail}</p>
                    <em>
                      {observation.evidence === scope
                        ? "This card"
                        : `From: ${observation.evidence}`}
                    </em>
                  </div>
                </li>
              ))}
            </ul>
          </article>

          <article className="insight-column">
            <h3>Recommendation</h3>
            {brief.actions.length === 0 ? (
              <p className="advisory-empty">
                Nothing crossed a threshold that justifies changing the account
                this period.
              </p>
            ) : (
              <ol className="advisory-list advisory-list--actions">
                {brief.actions.map((action) => (
                  <li key={action.id}>
                    <span
                      className={`severity-chip severity-chip--effort-${action.effort}`}
                    >
                      {EFFORT_LABEL[action.effort] ?? action.effort}
                    </span>
                    <div>
                      <strong>{action.action}</strong>
                      <p>{action.because}</p>
                      <em>
                        Expect {action.expectedMetric} to go{" "}
                        {action.expectedDirection}
                      </em>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </article>

          <p className="insight-strip__provenance">
            <span className={`source-chip source-chip--${brief.source}`}>
              {brief.source === "agent" ? "AI agent" : "Rule-based"}
            </span>
            {brief.provenanceNote}
          </p>
        </div>
      )}
    </section>
  );
}
