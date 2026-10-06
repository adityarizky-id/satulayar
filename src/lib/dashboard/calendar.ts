import type { DateRange } from "@/lib/dashboard/types";

/**
 * Calendar arithmetic for the reporting-period picker. Every function works on
 * inclusive `YYYY-MM-DD` strings in UTC so a range resolves identically on the
 * server, in the browser, and in tests regardless of the viewer's own clock.
 */

/** Sunday-first, matching the two-month grid the picker renders. */
export const WEEKDAY_LABELS = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
] as const;

export const MONTH_LABELS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const DAY_MS = 86_400_000;

function toUtc(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return toIso(new Date(toUtc(date).getTime() + days * DAY_MS));
}

/** Calendar-safe month shift: the day is clamped to the target month's length. */
export function addMonths(date: string, months: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const shifted = month - 1 + months;
  const targetYear = year + Math.floor(shifted / 12);
  const targetMonth = ((shifted % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();

  return [
    String(targetYear).padStart(4, "0"),
    String(targetMonth + 1).padStart(2, "0"),
    String(Math.min(day, lastDay)).padStart(2, "0"),
  ].join("-");
}

export function startOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

export function endOfMonth(date: string): string {
  const [year, month] = date.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${date.slice(0, 7)}-${String(lastDay).padStart(2, "0")}`;
}

/** Weeks start on Sunday, so the grid header reads Sun through Sat. */
export function startOfWeek(date: string): string {
  return addDays(date, -toUtc(date).getUTCDay());
}

export function inclusiveDays(range: DateRange): number {
  return Math.round(
    (toUtc(range.end).getTime() - toUtc(range.start).getTime()) / DAY_MS,
  ) + 1;
}

export function isWithinRange(date: string, range: DateRange): boolean {
  return date >= range.start && date <= range.end;
}

export function monthLabel(date: string): string {
  const [year, month] = date.split("-").map(Number);
  return `${MONTH_LABELS[month - 1]} ${year}`;
}

/**
 * A month laid out as whole Sunday-to-Saturday weeks. Cells outside the month
 * are `null` so the picker can render them as blanks instead of borrowing days
 * from a neighbouring month, which would make two adjacent panes ambiguous.
 */
export function buildMonthGrid(month: string): (string | null)[][] {
  const first = startOfMonth(month);
  const last = endOfMonth(month);
  const leading = toUtc(first).getUTCDay();
  const weeks: (string | null)[][] = [];

  let cursor = first;
  let week: (string | null)[] = Array.from({ length: leading }, () => null);

  while (cursor <= last) {
    week.push(cursor);
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
    cursor = addDays(cursor, 1);
  }

  if (week.length > 0) {
    while (week.length < 7) week.push(null);
    weeks.push(week);
  }

  return weeks;
}

/** Human date for labels and screen-reader names, e.g. `14 Jul 2026`. */
export function formatCalendarDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return `${day} ${MONTH_LABELS[month - 1].slice(0, 3)} ${year}`;
}

/** Full date for a day cell's accessible name, e.g. `14 July 2026`. */
export function formatCalendarDateLong(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return `${day} ${MONTH_LABELS[month - 1]} ${year}`;
}
