"use client";

import { useMemo, useState } from "react";

import { InsightAttachment } from "@/components/dashboard/advisory-panels";
import { ChevronIcon } from "@/components/dashboard/icons";
import { buildCampaignTypeAdvisory } from "@/lib/dashboard/campaign-advisory";
import {
  buildCampaigns,
  type CampaignTypeAnalysis,
  type CampaignTypeRow,
} from "@/lib/dashboard/campaign-types";
import { volumeVerdict } from "@/lib/dashboard/confidence";
import type { PerformanceTargets } from "@/lib/dashboard/targets";
import type { Currency, Platform } from "@/lib/dashboard/types";

type TypeVerdict = "pass" | "breach" | "assisted" | "insufficient";

function ComparisonDelta({
  current,
  previous,
  label,
  lowerIsBetter = false,
}: {
  current: number | null;
  previous: number | null | undefined;
  label: string;
  lowerIsBetter?: boolean;
}) {
  if (current === null || previous === null || previous === undefined) {
    return <small className="metric-delta metric-delta--muted">No baseline</small>;
  }
  if (previous === 0) {
    return (
      <small className="metric-delta metric-delta--muted">
        {current === 0 ? `Flat vs ${label}` : `New vs ${label}`}
      </small>
    );
  }

  const change = ((current - previous) / Math.abs(previous)) * 100;
  const improved = lowerIsBetter ? change < 0 : change > 0;
  const tone = Math.abs(change) < 0.05 ? "muted" : improved ? "good" : "bad";
  return (
    <small className={`metric-delta metric-delta--${tone}`}>
      {change > 0 ? "+" : ""}{change.toFixed(1)}% vs {label}
    </small>
  );
}

const VERDICT_LABEL: Record<TypeVerdict, string> = {
  pass: "inside target",
  breach: "over target",
  assisted: "assisted role",
  insufficient: "too few orders",
};

function verdictFor(row: CampaignTypeRow, target: number): TypeVerdict {
  if (!row.judgedOnCostPerOrder) return "assisted";
  if (
    row.costPerPurchase === null ||
    volumeVerdict(row.purchases).confidence === "insufficient"
  ) {
    return "insufficient";
  }
  return row.costPerPurchase > target ? "breach" : "pass";
}

export function CampaignTypeSection({
  analysis,
  currency,
  targets,
  selectedPlatform,
  accountSlug,
  comparisonEnabled,
  comparisonLabel,
}: {
  analysis: CampaignTypeAnalysis | null;
  currency: Currency;
  targets: PerformanceTargets;
  selectedPlatform: Platform;
  accountSlug: string;
  comparisonEnabled: boolean;
  comparisonLabel: string;
}) {
  const [openType, setOpenType] = useState<string | null>(null);
  const [openCampaign, setOpenCampaign] = useState<string | null>(null);

  const currencyFormatter = useMemo(
    () =>
      new Intl.NumberFormat("en-GB", {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
      }),
    [currency],
  );
  const numberFormatter = useMemo(
    () => new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }),
    [],
  );

  const advisory = useMemo(
    () => (analysis ? buildCampaignTypeAdvisory(analysis, targets) : null),
    [analysis, targets],
  );

  if (!analysis || !advisory) return null;

  const target = targets.costPerOrder;
  const maxSpend = Math.max(...analysis.rows.map((row) => row.spend), 1);
  const campaignCount =
    analysis.totals.spend === 0
      ? 0
      : analysis.rows.reduce((sum, row) => sum + row.campaigns, 0);
  const groupCount = analysis.rows.reduce((sum, row) => sum + row.adGroups, 0);
  const active = analysis.rows.find((row) => row.key === openType) ?? null;
  // Real campaigns when the row carries them; the generated list is only for
  // the synthetic preview, and must never sit underneath live money.
  const campaigns = active
    ? active.campaignRows ?? buildCampaigns(active, accountSlug, analysis.range)
    : [];
  const maxCampaignSpend = Math.max(...campaigns.map((row) => row.spend), 1);

  const percent = (value: number | null) =>
    value === null ? "N/A" : `${(value * 100).toFixed(1)}%`;

  return (
    <section className="section" id="campaign-types">
      {analysis.dataOrigin === "synthetic-illustration" && (
        <div
          className="console-notice console-notice--warning"
          role="note"
          data-origin="synthetic-illustration"
        >
          <div>
            <strong>Synthetic illustration · under development</strong>
            <p>
              These campaign types, campaign names, ad groups and figures are
              modelled from the Google account total with fixed shares. They
              are not read from Google Ads. Do not use them for budget, bid, or
              pause decisions.
            </p>
          </div>
        </div>
      )}
      <header className="campaign-section-heading">
        <div className="campaign-section-heading__copy">
          <span className="eyebrow">Account diagnostic</span>
          <h2>
            Campaign types
            {selectedPlatform === "all" && (
              <span className="metric-tag metric-tag--google">
                Google Ads only
              </span>
            )}
          </h2>
          <p>
            Read performance through each campaign&rsquo;s role. Demand creation
            stays visible without being judged against a direct-response order
            target.
          </p>
        </div>

        <div
          aria-label={`${campaignCount} campaigns lead to ${groupCount} ad or asset groups. Comparison ${comparisonEnabled ? comparisonLabel : "off"}.`}
          className="campaign-scope-rail"
          role="group"
        >
          <span className="campaign-scope-rail__metric">
            <strong>{campaignCount}</strong>
            <small>Campaigns</small>
          </span>
          <span aria-hidden="true" className="campaign-scope-rail__connector">
            <i />
          </span>
          <span className="campaign-scope-rail__metric">
            <strong>{groupCount}</strong>
            <small>Ad / asset groups</small>
          </span>
          <span
            className={`campaign-scope-rail__baseline${
              comparisonEnabled ? " is-active" : " is-muted"
            }`}
          >
            <small>Comparison</small>
            <strong>{comparisonEnabled ? comparisonLabel : "Off"}</strong>
          </span>
        </div>
      </header>

      <InsightAttachment brief={advisory} scope="Campaign types" />

      <div className="type-board">
        {analysis.rows.map((row) => {
          const verdict = verdictFor(row, target);
          const isOpen = openType === row.key;

          return (
            <article
              className={`type-card type-card--${verdict}${
                isOpen ? " type-card--open" : ""
              }`}
              key={row.key}
            >
              <button
                aria-expanded={isOpen}
                className="type-card__bar"
                onClick={() => {
                  setOpenType(isOpen ? null : row.key);
                  setOpenCampaign(null);
                }}
                type="button"
              >
                <span className="type-card__identity">
                  <strong>{row.label}</strong>
                  <small>{row.roleLabel}</small>
                </span>

                <span className="type-card__spend">
                  <span className="type-card__track">
                    <i style={{ width: `${(row.spend / maxSpend) * 100}%` }} />
                  </span>
                  <b>{currencyFormatter.format(row.spend)}</b>
                  <em>{Math.round(row.spendShare * 100)}% of spend</em>
                  {comparisonEnabled && (
                    <ComparisonDelta
                      current={row.spend}
                      previous={row.previous?.spend}
                      label={comparisonLabel}
                    />
                  )}
                </span>

                <div className="type-card__metrics">
                  <div>
                    <span className="type-card__metric-label">Orders</span>
                    <strong className="type-card__metric-value">
                      {numberFormatter.format(row.purchases)}
                    </strong>
                    {comparisonEnabled && (
                      <ComparisonDelta current={row.purchases} previous={row.previous?.purchases} label={comparisonLabel} />
                    )}
                  </div>
                  <div>
                    <span className="type-card__metric-label">Cost per order</span>
                    <strong className="type-card__metric-value">
                      {row.costPerPurchase === null
                        ? "N/A"
                        : currencyFormatter.format(row.costPerPurchase)}
                    </strong>
                    {comparisonEnabled && (
                      <ComparisonDelta current={row.costPerPurchase} previous={row.previous?.costPerPurchase} label={comparisonLabel} lowerIsBetter />
                    )}
                  </div>
                  <div>
                    <span className="type-card__metric-label">ROAS</span>
                    <strong className="type-card__metric-value">
                      {row.returnOnAdSpend === null
                        ? "N/A"
                        : `${row.returnOnAdSpend.toFixed(2)}×`}
                    </strong>
                    {comparisonEnabled && (
                      <ComparisonDelta current={row.returnOnAdSpend} previous={row.previous?.returnOnAdSpend} label={comparisonLabel} />
                    )}
                  </div>
                </div>

                <span className={`geo-chip geo-chip--${
                  verdict === "breach"
                    ? "breach"
                    : verdict === "pass"
                      ? "pass"
                      : "insufficient"
                }`}>
                  {VERDICT_LABEL[verdict]}
                </span>

                <span className="type-card__caret" aria-hidden="true">
                  <ChevronIcon />
                </span>
              </button>

              {isOpen && (
                <div className="type-card__drill">
                  <div className="type-card__drill-head">
                    <span className="eyebrow">
                      {campaigns.length} campaign
                      {campaigns.length === 1 ? "" : "s"}
                      {row.adGroups > 0 &&
                        ` · ${row.adGroups} ad / asset group${row.adGroups === 1 ? "" : "s"}`}
                    </span>
                    <span className="type-card__drill-note">
                      {row.judgedOnCostPerOrder
                        ? `Compared against the ${currencyFormatter.format(target)} order target.`
                        : "Assisted role: cost per order is shown for context, not as a verdict."}
                    </span>
                  </div>

                  <ul className="campaign-list">
                    {campaigns.map((campaign) => {
                      const campaignOpen = openCampaign === campaign.id;
                      const readable =
                        volumeVerdict(campaign.purchases).confidence !==
                        "insufficient";
                      const over =
                        row.judgedOnCostPerOrder &&
                        readable &&
                        (campaign.costPerPurchase ?? 0) > target;

                      return (
                        <li key={campaign.id}>
                          <button
                            aria-expanded={campaignOpen}
                            className="campaign-row"
                            onClick={() =>
                              setOpenCampaign(campaignOpen ? null : campaign.id)
                            }
                            type="button"
                          >
                            <span className="campaign-row__name">
                              <span className="type-card__group-bar">
                                <i
                                  style={{
                                    width: `${
                                      (campaign.spend / maxCampaignSpend) * 100
                                    }%`,
                                  }}
                                />
                              </span>
                              <strong>{campaign.name}</strong>
                              <small>
                                {campaign.adGroups.length} {campaign.adGroups[0]?.entityLevel === "asset_group" ? "asset" : "ad"} group
                                {campaign.adGroups.length === 1 ? "" : "s"}
                              </small>
                            </span>
                            <span
                              className={`status-pill status-pill--${campaign.status}`}
                            >
                              {campaign.status}
                            </span>
                            <span className="campaign-row__figures">
                              <b>{currencyFormatter.format(campaign.spend)}</b>
                              <span>
                                {numberFormatter.format(campaign.purchases)}{" "}
                                orders
                              </span>
                              <span className={over ? "cell--breach" : undefined}>
                                {campaign.costPerPurchase === null
                                  ? "N/A"
                                  : `${currencyFormatter.format(campaign.costPerPurchase)} / order`}
                              </span>
                              {comparisonEnabled && (
                                <ComparisonDelta
                                  current={campaign.costPerPurchase}
                                  previous={campaign.previous?.costPerPurchase}
                                  label={comparisonLabel}
                                  lowerIsBetter
                                />
                              )}
                            </span>
                            <span
                              aria-hidden="true"
                              className="type-card__caret"
                            >
                              <ChevronIcon />
                            </span>
                          </button>

                          {campaignOpen && campaign.adGroups.length === 0 && (
                            <p className="type-card__drill-note">
                              No ad group or asset group rows are stored for this
                              campaign in the selected period.
                            </p>
                          )}

                          {campaignOpen && campaign.adGroups.length > 0 && (
                            <div className="table-scroller">
                              <table>
                                <thead>
                                  <tr>
                                    <th>Group</th>
                                    <th>Type</th>
                                    <th>Status</th>
                                    <th>Spend</th>
                                    <th>Clicks</th>
                                    <th>CTR</th>
                                    <th>Regist.</th>
                                    <th>Orders</th>
                                    <th>Cost per order</th>
                                    <th>ROAS</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {campaign.adGroups.map((group) => {
                                    const groupReadable =
                                      volumeVerdict(group.purchases)
                                        .confidence !== "insufficient";
                                    const groupOver =
                                      row.judgedOnCostPerOrder &&
                                      groupReadable &&
                                      (group.costPerPurchase ?? 0) > target;

                                    return (
                                      <tr key={group.id}>
                                        <th>
                                          {group.name}
                                          <em className="cell--caveat">
                                            {group.conversionBasis === "google-total"
                                              ? "Google total conversions"
                                              : group.conversionBasis === "unavailable"
                                                ? "Conversions unavailable"
                                                : "Action-filtered conversions"}
                                          </em>
                                        </th>
                                        <td>{group.entityLevel === "asset_group" ? "Asset group" : "Ad group"}</td>
                                        <td>
                                          <span
                                            className={`status-pill status-pill--${group.status}`}
                                          >
                                            {group.status}
                                          </span>
                                        </td>
                                        <td>
                                          {currencyFormatter.format(group.spend)}
                                          {comparisonEnabled && (
                                            <ComparisonDelta current={group.spend} previous={group.previous?.spend} label={comparisonLabel} />
                                          )}
                                        </td>
                                        <td>
                                          {numberFormatter.format(group.clicks)}
                                        </td>
                                        <td>{percent(group.ctr)}</td>
                                        <td>
                                          {numberFormatter.format(
                                            group.registrations,
                                          )}
                                        </td>
                                        <td>
                                          {numberFormatter.format(
                                            group.purchases,
                                          )}
                                        </td>
                                        <td
                                          className={
                                            groupOver ? "cell--breach" : undefined
                                          }
                                        >
                                          {group.costPerPurchase === null
                                            ? "N/A"
                                            : currencyFormatter.format(
                                                group.costPerPurchase,
                                              )}
                                          {!groupReadable && (
                                            <em className="cell--caveat">
                                              {group.purchases} order
                                              {group.purchases === 1 ? "" : "s"}
                                            </em>
                                          )}
                                          {comparisonEnabled && (
                                            <ComparisonDelta current={group.costPerPurchase} previous={group.previous?.costPerPurchase} label={comparisonLabel} lowerIsBetter />
                                          )}
                                        </td>
                                        <td>
                                          {group.returnOnAdSpend === null
                                            ? "N/A"
                                            : `${group.returnOnAdSpend.toFixed(2)}×`}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </article>
          );
        })}
      </div>

      <p className="semantic-note">{analysis.safeMessage}</p>
    </section>
  );
}
