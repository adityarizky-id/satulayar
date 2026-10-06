import {
  REPORTING_CYCLE_DAYS,
  resolvePacingCycle,
  type ReportingCycle,
} from "@/lib/dashboard/timeframes";
import type {
  Currency,
  DailyMetric,
  DateRange,
  Platform,
} from "@/lib/dashboard/types";

/**
 * Monthly budget per platform, in the account's own currency. It is entered by
 * hand because the plan is re-agreed every cycle, and it is never converted.
 *
 * This is the figure the team signed off with the client. Nothing derived
 * from it may take its place on screen: a reader who sees a prorated share
 * labelled as "the budget" carries the wrong number into a meeting.
 */
export interface MonthlyBudgets {
  meta: number;
  google: number;
}

export const DEFAULT_BUDGETS: MonthlyBudgets = { meta: 1_500, google: 1_500 };

/**
 * One cookie per brand. The old global `sl_budgets` held a single pair for
 * every brand at once, so switching from Kopi Senja Nusantara to Kriya Bali carried Kopi Senja's
 * plan across and paced Spanish euros against a British pound figure.
 *
 * The legacy name survives only so the shell can expire it. Its value is NOT
 * inherited: a global cookie cannot be attributed to one brand without
 * guessing which brand was selected when it was written, and that guess is the
 * exact failure this split removes.
 */
export const LEGACY_BUDGETS_COOKIE = "sl_budgets";
export const BUDGETS_COOKIE_PREFIX = "sl_budgets_";

export function budgetsCookieName(clientSlug: string): string {
  return `${BUDGETS_COOKIE_PREFIX}${clientSlug}`;
}

/**
 * Where the agreed plan on screen came from. An unset plan must never look
 * like an agreed one: the built-in 1,500 default is a placeholder, and a card
 * that prints it without saying so invents a budget the team never signed.
 */
export type BudgetPlanSource =
  /** A stored agreement for exactly this reporting cycle. */
  | "agreed"
  /** The most recent earlier agreement, reused because this cycle has none. */
  | "carried-forward"
  /** A figure typed into this browser only. Preview and demo paths. */
  | "local"
  /** No agreement anywhere. The built-in default is standing in. */
  | "unset";

/**
 * The word a pacing sentence uses for the plan. Only a stored agreement may be
 * called "agreed"; a browser-only figure is a draft and the built-in default
 * is a placeholder, so no sentence claims a sign-off that never happened.
 */
export function describePlanBudget(source: BudgetPlanSource | undefined): string {
  switch (source) {
    case "agreed":
      return "agreed";
    case "carried-forward":
      return "carried-forward";
    case "local":
      return "draft";
    case "unset":
      return "placeholder";
    default:
      return "planned";
  }
}

export type PacingStatus =
  | "on-track"
  | "underspending"
  | "overspending"
  | "no-budget";

export interface PlatformPacing {
  platform: Exclude<Platform, "all">;
  /**
   * The agreed plan for the WHOLE 30-day cycle, shown as given. There is no
   * prorated variant of it: the team signs one figure per cycle, and any
   * smaller number derived from a filter is a figure nobody agreed to.
   */
  monthlyBudget: number;
  /** Spend from the cycle's first day to the reference day, inclusive. */
  spentToDate: number;
  /** Where the cycle should be if spend were even, 0 to 1. */
  expectedProgress: number;
  /** Spend against the agreed cycle budget, 0 to 1. */
  actualProgress: number;
  /** Cycle-end spend if the current daily rate holds to day 30. */
  projectedCycleEnd: number | null;
  /** Agreed budget minus cycle-to-date spend. Negative once overspent. */
  remainingBudget: number;
  /** Days of the CYCLE already spent, 0 to 30. */
  daysElapsed: number;
  /** Days of the CYCLE still to come, 0 to 30. */
  daysRemaining: number;
  /** What to spend per remaining cycle day to land exactly on the budget. */
  recommendedDailySpend: number | null;
  currentDailySpend: number | null;
  status: PacingStatus;
  safeMessage: string;
}

export interface BudgetPacingReport {
  /** The 30-day reporting cycle being paced. This is the period that counts. */
  cycle: ReportingCycle;
  cycleDays: number;
  /**
   * The reader's active filter, kept only so the card can say out loud when it
   * differs from the cycle. Nothing here is a pacing denominator.
   */
  filterStart: string;
  filterEnd: string;
  filterDays: number;
  /** True when the filter covers exactly the cycle and nothing else. */
  filterMatchesCycle: boolean;
  /**
   * The agreed plan this report was built from, echoed back so the client can
   * adopt the selected brand's figures instead of keeping the last brand's.
   */
  monthlyBudgets: MonthlyBudgets;
  /** Whether those figures are an agreement, a local entry, or a placeholder. */
  planSource: BudgetPlanSource;
  /** The cycle the agreement was recorded against, when there is one. */
  planCycleStart: string | null;
  currency: Currency;
  /** The day pacing is read up to: today, or the cycle's end once it closed. */
  referenceDate: string;
  platforms: PlatformPacing[];
  totalMonthlyBudget: number;
  totalSpentToDate: number;
  totalProjected: number;
}

function clampNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(parsed, 10_000_000);
}

export function normaliseBudgets(
  input: Partial<Record<keyof MonthlyBudgets, unknown>>,
): MonthlyBudgets {
  return {
    meta: clampNumber(input.meta, DEFAULT_BUDGETS.meta),
    google: clampNumber(input.google, DEFAULT_BUDGETS.google),
  };
}

export function parseBudgetsFromParams(
  params: URLSearchParams,
): MonthlyBudgets {
  return normaliseBudgets({
    meta: params.get("budgetMeta") ?? undefined,
    google: params.get("budgetGoogle") ?? undefined,
  });
}

export function serialiseBudgets(budgets: MonthlyBudgets): string {
  return [budgets.meta, budgets.google].join(",");
}

export function parseBudgetsCookie(
  value: string | null | undefined,
): MonthlyBudgets {
  if (!value) return DEFAULT_BUDGETS;
  const [meta, google] = value.split(",");
  return normaliseBudgets({ meta, google });
}

/** Inclusive day count of a window; 0 when the dates are unusable. */
function daysInRange(range: DateRange): number {
  const start = Date.parse(`${range.start}T00:00:00Z`);
  const end = Date.parse(`${range.end}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  return Math.floor((end - start) / 86_400_000) + 1;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Pacing is read over the 30-day reporting CYCLE, never over the reader's
 * filter.
 *
 * The budget is agreed per cycle — cycles run, for example, 25 Jul to 23 Aug,
 * 24 Aug to 22 Sep and so on — and that agreement does not change because the
 * operator switched the timeframe picker. An earlier version prorated the plan
 * over whatever window happened to be selected, which produced two figures
 * nobody could act on: a prorated "window target" the team never signed, and
 * a "window closed" verdict while the cycle still
 * had two days left to steer.
 *
 * So the filter decides only WHICH cycle is paced, through the cycle its last
 * day falls in. Everything else — the budget, the days elapsed, the days
 * remaining, the recommended daily spend — comes from the cycle itself.
 *
 * The consequence is deliberate and must stay visible on screen: this card
 * reports a different period from the platform table beneath it whenever the
 * filter is not the cycle. `filterMatchesCycle` exists so the card can say so
 * in words rather than leaving two spend figures side by side unexplained.
 */
export function buildBudgetPacing(
  rows: readonly DailyMetric[],
  /** The reader's active filter. It selects the cycle, nothing more. */
  range: DateRange,
  budgets: MonthlyBudgets,
  currency: Currency,
  /** Only platforms in scope are paced; a Google view must not show Meta. */
  platform: Platform = "all",
  /**
   * Today, in the account's timezone. Defaults to the filter's last day for
   * isolated previews. A cycle that has already closed clamps to its own end,
   * so a historic cycle reads as fully elapsed rather than as running.
   */
  referenceDate: string = range.end,
  /** Provenance of `budgets`, so the card can label a placeholder as one. */
  plan: { source?: BudgetPlanSource; cycleStart?: string | null } = {},
): BudgetPacingReport {
  const cycle = resolvePacingCycle(range, referenceDate);
  const filterDays = daysInRange(range);

  // Past the cycle's end the cycle is closed, not still running; before its
  // start nothing has been spent yet. `daysInRange` returns 0 for an inverted
  // range, which is exactly the "not started" case.
  const elapsedEnd = referenceDate < cycle.end ? referenceDate : cycle.end;
  const daysElapsed = Math.min(
    REPORTING_CYCLE_DAYS,
    daysInRange({ start: cycle.start, end: elapsedEnd }),
  );
  const daysRemaining = Math.max(REPORTING_CYCLE_DAYS - daysElapsed, 0);

  // Rows outside the cycle never count, whatever the caller passed in. This is
  // the cycle's own window, not the filter's: a "last 7 days" filter still
  // paces the full cycle, and its caller must supply the cycle's rows.
  const cycleRows = rows.filter(
    (row) => row.date >= cycle.start && row.date <= elapsedEnd,
  );

  const platforms = (["meta", "google"] as const)
    .filter((item) => platform === "all" || platform === item)
    .map<PlatformPacing>((platform) => {
      const monthlyBudget = budgets[platform];
      const spentToDate = round2(
        cycleRows
          .filter((row) => row.platform === platform)
          .reduce((total, row) => total + row.spend, 0),
      );
      const expectedProgress = daysElapsed / REPORTING_CYCLE_DAYS;
      const actualProgress = monthlyBudget > 0 ? spentToDate / monthlyBudget : 0;
      const currentDailySpend =
        daysElapsed > 0 ? spentToDate / daysElapsed : null;
      const projectedCycleEnd =
        currentDailySpend === null
          ? null
          : round2(currentDailySpend * REPORTING_CYCLE_DAYS);
      const remainingBudget = round2(monthlyBudget - spentToDate);
      const recommendedDailySpend =
        daysRemaining <= 0
          ? null
          : round2(Math.max(remainingBudget, 0) / daysRemaining);

      const drift = actualProgress - expectedProgress;
      const status: PacingStatus =
        monthlyBudget <= 0
          ? "no-budget"
          : drift > 0.05
            ? "overspending"
            : drift < -0.05
              ? "underspending"
              : "on-track";

      const share = Math.round(actualProgress * 100);
      // Every message names the cycle it belongs to, so no sentence can be
      // quoted back against the wrong period.
      const period = `${cycle.label} cycle (${cycle.start} to ${cycle.end})`;
      const planWord = describePlanBudget(plan.source);
      const safeMessage =
        status === "no-budget"
          ? "No budget is set for this platform in this cycle yet."
          : daysRemaining <= 0
            ? `The ${period} is closed. It used ${share}% of its ${planWord} ${monthlyBudget} ${currency} budget.`
            : status === "overspending"
              ? `Ahead of plan by ${Math.round(drift * 100)} points with ${daysRemaining} days left in the ${period}. ${recommendedDailySpend ?? 0} ${currency} a day lands on the ${planWord} ${monthlyBudget} ${currency} budget.`
              : status === "underspending"
                ? `Behind plan by ${Math.round(Math.abs(drift) * 100)} points with ${daysRemaining} days left in the ${period}. ${recommendedDailySpend ?? 0} ${currency} a day is needed to reach the ${planWord} ${monthlyBudget} ${currency} budget.`
                : `On plan against the ${planWord} ${monthlyBudget} ${currency} budget for the ${period}. Hold near ${recommendedDailySpend ?? 0} ${currency} a day for the remaining ${daysRemaining} days.`;

      return {
        platform,
        monthlyBudget,
        spentToDate,
        expectedProgress,
        actualProgress,
        projectedCycleEnd,
        remainingBudget,
        daysElapsed,
        daysRemaining,
        recommendedDailySpend,
        currentDailySpend:
          currentDailySpend === null ? null : round2(currentDailySpend),
        status,
        safeMessage,
      };
    });

  return {
    cycle,
    cycleDays: REPORTING_CYCLE_DAYS,
    filterStart: range.start,
    filterEnd: range.end,
    filterDays,
    filterMatchesCycle:
      range.start === cycle.start && range.end === cycle.end,
    monthlyBudgets: budgets,
    planSource: plan.source ?? "unset",
    planCycleStart: plan.cycleStart ?? null,
    currency,
    referenceDate: elapsedEnd,
    platforms,
    totalMonthlyBudget: round2(
      platforms.reduce((total, item) => total + item.monthlyBudget, 0),
    ),
    totalSpentToDate: round2(
      platforms.reduce((total, item) => total + item.spentToDate, 0),
    ),
    totalProjected: round2(
      platforms.reduce(
        (total, item) => total + (item.projectedCycleEnd ?? 0),
        0,
      ),
    ),
  };
}
