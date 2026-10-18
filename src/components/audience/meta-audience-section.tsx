"use client";

import { useMemo } from "react";

import {
  DemographicColumnChart,
  type DemographicAgeGroup,
} from "@/components/charts/demographic-column-chart";
import { BarList, type BarListRow } from "@/components/charts/bar-list";
import type { MetaAudienceAnalysis, AgeBracket } from "@/lib/dashboard/audience-meta";
import type { Currency } from "@/lib/dashboard/types";

function formatChange(value: number, previousValue: number): string {
  if (previousValue === 0) return "New";
  return `${(((value - previousValue) / previousValue) * 100).toFixed(1)}%`;
}

const AGE_BRACKETS: AgeBracket[] = [
  "18-24",
  "25-34",
  "35-44",
  "45-54",
  "55-64",
  "65+",
];

export function MetaAudienceSection({
  analysis,
  currency,
}: {
  analysis: MetaAudienceAnalysis | null;
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

  const totalDemographicSpend = analysis.demographics.reduce(
    (total, row) => total + row.spend,
    0,
  );

  const femaleDemographics = analysis.demographics.filter(
    (row) => row.gender === "female",
  );
  const femaleSpend = femaleDemographics.reduce((sum, r) => sum + r.spend, 0);
  const femaleShare =
    totalDemographicSpend > 0 ? (femaleSpend / totalDemographicSpend) * 100 : 0;

  const maleDemographics = analysis.demographics.filter(
    (row) => row.gender === "male",
  );
  const maleSpend = maleDemographics.reduce((sum, r) => sum + r.spend, 0);
  const maleShare =
    totalDemographicSpend > 0 ? (maleSpend / totalDemographicSpend) * 100 : 0;

  const ageGroups: DemographicAgeGroup[] = AGE_BRACKETS.map((age) => {
    const femaleRow = analysis.demographics.find(
      (r) => r.age === age && r.gender === "female",
    );
    const maleRow = analysis.demographics.find(
      (r) => r.age === age && r.gender === "male",
    );
    const fSpend = femaleRow?.spend ?? 0;
    const mSpend = maleRow?.spend ?? 0;
    const totalSpend = fSpend + mSpend;
    const purchases = (femaleRow?.purchases ?? 0) + (maleRow?.purchases ?? 0);
    const purchaseValue =
      (femaleRow?.purchaseValue ?? 0) + (maleRow?.purchaseValue ?? 0);
    const roas = totalSpend > 0 ? purchaseValue / totalSpend : null;

    return {
      key: `meta-age-${age}`,
      age,
      femaleSpend: fSpend,
      maleSpend: mSpend,
      totalSpend,
      purchases,
      roas,
    };
  });

  const typeRows: BarListRow[] = analysis.audienceTypes.map((row) => ({
    key: row.key,
    label: row.label,
    value: row.spend,
    previousValue: null,
    share: row.spendShare,
  }));

  return (
    <section className="section" id="audience">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Account diagnostic</span>
          <h2>Audience</h2>
        </div>
        <p>
          Meta reports age and gender as one crossed grid, and separately tags
          which targeting type — Core, Custom, or Lookalike — each ad set
          uses. Both cuts below follow Meta&apos;s own breakdown shape.
        </p>
      </div>

      <article className="panel">
        <div className="panel__heading">
          <div>
            <span className="eyebrow">Age &amp; gender</span>
            <h3 className="panel__title">Spend by demographic</h3>
          </div>
        </div>
        <DemographicColumnChart
          ageGroups={ageGroups}
          ariaLabel="Meta Ads spend by age bracket and gender"
          femaleLabel="Women"
          femaleOverallShare={femaleShare}
          formatValue={(value) => currencyFormatter.format(value)}
          maleLabel="Men"
          maleOverallShare={maleShare}
          totalFemaleSpend={femaleSpend}
          totalMaleSpend={maleSpend}
        />
      </article>

      <div className="table-scroller">
        <table>
          <caption className="visually-hidden">
            Meta Ads performance by age and gender for the selected period
          </caption>
          <thead>
            <tr>
              <th scope="col">Age &amp; gender</th>
              <th scope="col">Spend</th>
              <th scope="col">Impressions</th>
              <th scope="col">Clicks</th>
              <th scope="col">CTR</th>
              <th scope="col">Registrations</th>
              <th scope="col">Purchases</th>
              <th scope="col">CPO</th>
              <th scope="col">Purchase value</th>
              <th scope="col">ROAS</th>
            </tr>
          </thead>
          <tbody>
            {analysis.demographics.map((row) => (
              <tr key={row.key}>
                <th scope="row">{row.label}</th>
                <td data-label="Spend">{currencyFormatter.format(row.spend)}</td>
                <td data-label="Impressions">
                  {numberFormatter.format(row.impressions)}
                </td>
                <td data-label="Clicks">{numberFormatter.format(row.clicks)}</td>
                <td data-label="CTR">{percent(row.ctr)}</td>
                <td data-label="Registrations">
                  {numberFormatter.format(row.registrations)}
                </td>
                <td data-label="Purchases">
                  {numberFormatter.format(row.purchases)}
                </td>
                <td data-label="CPO">
                  {row.costPerPurchase === null
                    ? "N/A"
                    : currencyFormatter.format(row.costPerPurchase)}
                </td>
                <td data-label="Purchase value">
                  {currencyFormatter.format(row.purchaseValue)}
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

      <article className="panel">
        <div className="panel__heading">
          <div>
            <span className="eyebrow">Targeting type</span>
            <h3 className="panel__title">Spend by audience type</h3>
          </div>
        </div>
        <BarList
          formatChange={formatChange}
          formatValue={(value) => currencyFormatter.format(value)}
          rows={typeRows}
        />
      </article>

      <div className="table-scroller">
        <table>
          <caption className="visually-hidden">
            Meta Ads performance by audience type for the selected period
          </caption>
          <thead>
            <tr>
              <th scope="col">Audience type</th>
              <th scope="col">Spend</th>
              <th scope="col">Purchases</th>
              <th scope="col">CPO</th>
              <th scope="col">CPA</th>
              <th scope="col">ROAS</th>
            </tr>
          </thead>
          <tbody>
            {analysis.audienceTypes.map((row) => (
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
