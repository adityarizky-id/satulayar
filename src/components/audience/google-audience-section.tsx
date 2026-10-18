"use client";

import { useMemo } from "react";

import {
  DemographicColumnChart,
  type DemographicAgeGroup,
} from "@/components/charts/demographic-column-chart";
import { BarList, type BarListRow } from "@/components/charts/bar-list";
import type { GoogleAudienceAnalysis } from "@/lib/dashboard/audience-google";
import type { Currency } from "@/lib/dashboard/types";

function formatChange(value: number, previousValue: number): string {
  if (previousValue === 0) return "New";
  return `${(((value - previousValue) / previousValue) * 100).toFixed(1)}%`;
}

export function GoogleAudienceSection({
  analysis,
  currency,
}: {
  analysis: GoogleAudienceAnalysis | null;
  currency: Currency;
}) {
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

  if (!analysis) return null;

  const percent = (value: number | null) =>
    value === null ? "N/A" : `${(value * 100).toFixed(1)}%`;

  const femaleGenderRow = analysis.genderRows.find((r) => r.key === "female");
  const maleGenderRow = analysis.genderRows.find((r) => r.key === "male");
  const totalFemaleSpend = femaleGenderRow?.spend ?? 0;
  const totalMaleSpend = maleGenderRow?.spend ?? 0;
  const totalKnownGenderSpend = totalFemaleSpend + totalMaleSpend;
  const femaleKnownRatio =
    totalKnownGenderSpend > 0 ? totalFemaleSpend / totalKnownGenderSpend : 0.5;
  const maleKnownRatio =
    totalKnownGenderSpend > 0 ? totalMaleSpend / totalKnownGenderSpend : 0.5;

  const totalGenderSpend = analysis.genderRows.reduce(
    (total, row) => total + row.spend,
    0,
  );
  const femaleOverallShare =
    totalGenderSpend > 0 ? (totalFemaleSpend / totalGenderSpend) * 100 : 0;
  const maleOverallShare =
    totalGenderSpend > 0 ? (totalMaleSpend / totalGenderSpend) * 100 : 0;

  const AGE_BRACKETS = ["18-24", "25-34", "35-44", "45-54", "55-64", "65+"];
  const googleAgeGroups: DemographicAgeGroup[] = AGE_BRACKETS.map((age) => {
    const ageRow = analysis.ageRows.find((r) => r.key === age);
    const ageSpend = ageRow?.spend ?? 0;
    const femaleSpend = ageSpend * femaleKnownRatio;
    const maleSpend = ageSpend * maleKnownRatio;
    const purchases = ageRow?.purchases ?? 0;
    const roas = ageRow?.returnOnAdSpend ?? null;

    return {
      key: `google-age-${age}`,
      age,
      femaleSpend,
      maleSpend,
      totalSpend: ageSpend,
      purchases,
      roas,
    };
  });

  const segmentRows: BarListRow[] = analysis.segments.map((row) => ({
    key: row.key,
    label: row.label,
    value: row.spend,
    previousValue: null,
    share: row.spendShare,
  }));

  return (
    <section className="section" id="audience-segments">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Account diagnostic</span>
          <h2>Audience segments</h2>
        </div>
        <p>
          {analysis.source === "measured"
            ? "Live performance from Google Ads audience segments attached to ad groups. The panel preserves Google’s reported criterion grain and does not manufacture demographic data that is absent from this feed."
            : "Google reports age and gender as two separate demographics reports, not one crossed grid, and segment performance is a third, separate targeting cut."}
        </p>
      </div>

      {analysis.source === "modelled" && (
        <>
        <article className="panel">
        <div className="panel__heading">
          <div>
            <span className="eyebrow">Age &amp; gender</span>
            <h3 className="panel__title">Spend by demographic</h3>
          </div>
        </div>
        <DemographicColumnChart
          ageGroups={googleAgeGroups}
          ariaLabel="Google Ads spend by age bracket and gender"
          femaleLabel="Women"
          femaleOverallShare={femaleOverallShare}
          footnote={`${Math.round(
            analysis.unknownAgeShare * 100,
          )}% of spend has unresolved demographic data (Display/video inventory).`}
          formatValue={(value) => currencyFormatter.format(value)}
          maleLabel="Men"
          maleOverallShare={maleOverallShare}
          totalFemaleSpend={totalFemaleSpend}
          totalMaleSpend={totalMaleSpend}
        />
      </article>

      <div className="table-scroller">
        <table>
          <caption className="visually-hidden">
            Google Ads performance by age and gender for the selected period
          </caption>
          <thead>
            <tr>
              <th scope="col">Demographic</th>
              <th scope="col">Spend</th>
              <th scope="col">Impressions</th>
              <th scope="col">Clicks</th>
              <th scope="col">CTR</th>
              <th scope="col">Purchases</th>
              <th scope="col">CPO</th>
              <th scope="col">ROAS</th>
            </tr>
          </thead>
          <tbody>
            {[
              ...analysis.ageRows.map((row) => ({ ...row, key: `age-${row.key}` })),
              ...analysis.genderRows.map((row) => ({ ...row, key: `gender-${row.key}` })),
            ].map((row) => (
              <tr key={row.key}>
                <th scope="row">
                  {row.label}
                  {row.isUnknown && <em className="cell--caveat"> · unresolved</em>}
                </th>
                <td data-label="Spend">{currencyFormatter.format(row.spend)}</td>
                <td data-label="Impressions">
                  {numberFormatter.format(row.impressions)}
                </td>
                <td data-label="Clicks">{numberFormatter.format(row.clicks)}</td>
                <td data-label="CTR">{percent(row.ctr)}</td>
                <td data-label="Purchases">
                  {numberFormatter.format(row.purchases)}
                </td>
                <td data-label="CPO">
                  {row.costPerPurchase === null
                    ? "N/A"
                    : currencyFormatter.format(row.costPerPurchase)}
                </td>
                <td data-label="ROAS">
                  {row.returnOnAdSpend === null
                    ? "N/A"
                    : `${row.returnOnAdSpend.toFixed(2)}×`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
        </>
      )}

      <article className="panel">
        <div className="panel__heading">
          <div>
            <span className="eyebrow">
              {analysis.source === "measured" ? "Live Google Ads" : "Targeting segment"}
            </span>
            <h3 className="panel__title">
              {analysis.source === "measured"
                ? "Spend by audience segment"
                : "Spend by segment type"}
            </h3>
          </div>
        </div>
        <BarList
          formatChange={formatChange}
          formatValue={(value) => currencyFormatter.format(value)}
          rows={segmentRows}
        />
        <details className="card-notes">
          <summary>Audience reporting notes</summary>
          <p>{analysis.safeMessage}</p>
        </details>
      </article>

      <div className="table-scroller">
        <table>
          <caption className="visually-hidden">
            Google Ads performance by audience segment for the selected period
          </caption>
          <thead>
            <tr>
              <th scope="col">
                {analysis.source === "measured" ? "Audience segment" : "Segment type"}
              </th>
              <th scope="col">Spend</th>
              <th scope="col">Purchases</th>
              <th scope="col">CPO</th>
              <th scope="col">CPA</th>
              <th scope="col">ROAS</th>
            </tr>
          </thead>
          <tbody>
            {analysis.segments.map((row) => (
              <tr key={row.key}>
                <th scope="row">
                  <strong>{row.label}</strong>
                  <br />
                  <small>{row.examples.join(" · ")}</small>
                </th>
                <td data-label="Spend">{currencyFormatter.format(row.spend)}</td>
                <td data-label="Purchases">
                  {numberFormatter.format(row.purchases)}
                </td>
                <td data-label="CPO">
                  {row.costPerPurchase === null
                    ? "N/A"
                    : currencyFormatter.format(row.costPerPurchase)}
                </td>
                <td data-label="CPA">
                  {row.costPerRegistration === null
                    ? "N/A"
                    : currencyFormatter.format(row.costPerRegistration)}
                </td>
                <td data-label="ROAS">
                  {row.returnOnAdSpend === null
                    ? "N/A"
                    : `${row.returnOnAdSpend.toFixed(2)}×`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

    </section>
  );
}
