import { formatCurrency } from "@/lib/dashboard/account-contract";
import type { DashboardSnapshot } from "@/lib/dashboard/types";

/**
 * Executive summary, written to be pasted into WhatsApp, Slack, or an email.
 *
 * Pure text assembly over a snapshot that has already been scored. The rule
 * that shapes every line: a figure appears only when the snapshot can support
 * it. A number that is blocked, unreconciled, or derived from an input nobody
 * supplied is labelled as such rather than rounded into confidence.
 */

export interface ExecutiveSummaryOptions {
  /**
   * Gross margin as a percentage, if the reader wants a profit line. Nothing in
   * the dashboard knows cost of goods, so without this there is no profit
   * figure — and an assumed margin would be a made-up number in a message to
   * stakeholders.
   */
  grossMarginPercent?: number;
  /** Overrides the generated-at stamp; used by tests. */
  now?: Date;
}

export interface ExecutiveSummaryLine {
  label: string;
  value: string;
  /** Short parenthetical, such as a comparison or a reason for unavailability. */
  note?: string;
}

export interface ExecutiveSummaryResult {
  title: string;
  lines: ExecutiveSummaryLine[];
  caveats: string[];
  /** True when the data-quality gate says this must not be published as final. */
  blocked: boolean;
  /** The whole thing as plain text, ready to paste. */
  text: string;
}

function formatPercent(value: number | null, fractionDigits = 1): string {
  if (value === null || !Number.isFinite(value)) return "unavailable";
  return `${value.toFixed(fractionDigits)}%`;
}

function formatRatio(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "unavailable";
  return `${value.toFixed(2)}x`;
}

function describeChange(current: number, previous: number): string | undefined {
  if (!Number.isFinite(previous) || previous === 0) return undefined;
  const delta = ((current - previous) / previous) * 100;
  const sign = delta >= 0 ? "+" : "";
  return `${sign}${delta.toFixed(1)}% vs previous period`;
}

/**
 * Builds the summary.
 *
 * Comparison notes are omitted when the reader switched comparison off, rather
 * than silently falling back to a baseline they did not ask for.
 */
export function buildExecutiveSummary(
  snapshot: DashboardSnapshot,
  options: ExecutiveSummaryOptions = {},
): ExecutiveSummaryResult {
  const currency = snapshot.account.currency;
  const totals = snapshot.totals;
  const comparison = snapshot.comparisonTotals;
  const comparisonOn = snapshot.comparisonEnabled;
  const lines: ExecutiveSummaryLine[] = [];
  const caveats: string[] = [];

  lines.push({
    label: "Period",
    value: `${snapshot.selectedRange.start} to ${snapshot.selectedRange.end}`,
    note: comparisonOn ? snapshot.comparisonBasis.label : "no comparison",
  });

  lines.push({
    label: "Ad spend",
    value: formatCurrency(totals.spend, currency, 2),
    note: comparisonOn ? describeChange(totals.spend, comparison.spend) : undefined,
  });

  lines.push({
    label: "Revenue (platform-reported)",
    value: formatCurrency(totals.actualPurchaseRevenue, currency, 2),
    note: comparisonOn
      ? describeChange(totals.actualPurchaseRevenue, comparison.actualPurchaseRevenue)
      : undefined,
  });

  lines.push({
    label: "ROAS",
    value: formatRatio(totals.actualRevenueRoas),
  });

  lines.push({
    label: "Orders",
    value: String(totals.purchases),
    note: comparisonOn ? describeChange(totals.purchases, comparison.purchases) : undefined,
  });

  lines.push({
    label: "Cost per order",
    value:
      totals.costPerPurchase === null
        ? "unavailable"
        : formatCurrency(totals.costPerPurchase, currency, 2),
  });

  // Null in live mode: store net sales are not read from the store yet, and an
  // exported summary must not carry a store figure the store never reported.
  const mer = snapshot.blendedMer;
  lines.push(
    mer
      ? {
        label: "Blended MER (store sales / ad spend)",
        value: formatRatio(mer.blendedMer),
        note: `store sales ${formatCurrency(mer.storeNetSales, currency, 2)}`,
      }
      : {
        label: "Blended MER (store sales / ad spend)",
        value: "unavailable",
        note: "store net sales are not connected yet",
      },
  );

  // Profit needs cost of goods, which no connector supplies. It appears only
  // when the reader states a margin, and the message says it is an estimate.
  const margin = options.grossMarginPercent;
  if (mer && typeof margin === "number" && Number.isFinite(margin)) {
    const profit = mer.storeNetSales * (margin / 100) - totals.spend;
    lines.push({
      label: "Gross profit after ad spend",
      value: formatCurrency(profit, currency, 2),
      note: `estimate at ${formatPercent(margin, 0)} gross margin`,
    });
  } else {
    lines.push({
      label: "Gross profit after ad spend",
      value: "unavailable",
      note: "no gross margin supplied; nothing here knows cost of goods",
    });
  }

  const pacing = snapshot.budgetPacing;
  const pacingPercent =
    pacing.totalMonthlyBudget > 0
      ? (pacing.totalSpentToDate / pacing.totalMonthlyBudget) * 100
      : null;
  const pacedDays = pacing.platforms[0]?.daysElapsed ?? 0;
  lines.push({
    label: "Budget pacing",
    value:
      pacingPercent === null
        ? "no budget set"
        : `${formatCurrency(pacing.totalSpentToDate, currency, 0)} of an agreed ${formatCurrency(pacing.totalMonthlyBudget, currency, 0)} cycle budget (${formatPercent(pacingPercent, 0)})`,
    // The cycle dates are spelled out because this line leaves the app. A
    // reader holding the exported summary cannot check which period it means.
    note: `${pacing.cycle.label} cycle, ${pacing.cycle.start} to ${pacing.cycle.end}, day ${pacedDays} of ${pacing.cycleDays}, projected ${formatCurrency(pacing.totalProjected, currency, 0)}`,
  });

  const blocked =
    snapshot.dataStatus === "blocked" || snapshot.quality.summaryBlocked;

  if (blocked) {
    caveats.push(
      "The data-quality gate has not cleared this period, so these figures are provisional and must not be circulated as final.",
    );
  }
  if (snapshot.quality.provisionalDates.length > 0) {
    caveats.push(
      `${snapshot.quality.provisionalDates.length} day(s) are still open on the platform and can change.`,
    );
  }
  for (const issue of snapshot.quality.issues) {
    caveats.push(issue.safeMessage);
  }
  if (snapshot.conversionCaveat) caveats.push(snapshot.conversionCaveat);
  if (mer) caveats.push(mer.reconciliationNote);

  const generatedAt = (options.now ?? new Date(snapshot.generatedAt))
    .toISOString()
    .slice(0, 16)
    .replace("T", " ");
  const title = `${snapshot.account.name} — paid media summary (${snapshot.selectedRange.start} to ${snapshot.selectedRange.end})`;

  const text = [
    title,
    "",
    ...lines.map((line) =>
      line.note ? `${line.label}: ${line.value} (${line.note})` : `${line.label}: ${line.value}`,
    ),
    "",
    "Notes:",
    ...caveats.map((caveat) => `- ${caveat}`),
    "",
    `Generated ${generatedAt} UTC from the Satulayar.`,
  ].join("\n");

  return { title, lines, caveats, blocked, text };
}
