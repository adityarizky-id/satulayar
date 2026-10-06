import type {
  Platform,
  WorklogEntry,
  WorklogPlatform,
} from "@/lib/dashboard/types";

/**
 * Worklog: what the team changed, when, and why.
 *
 * The blueprint requires a worklog entry to be reviewed before it can support
 * a summary, so an entry carries a status and only approved entries reach the
 * paid-ads overview. Nothing here is a metric: the worklog explains movement,
 * it never becomes the movement.
 */
export const WORKLOG_ACTION_TYPES = [
  "Budget change",
  "Bid or target change",
  "Creative rotation",
  "Audience change",
  "Keyword or negative",
  "Landing page change",
  "Tracking or measurement fix",
  "Structure change",
  "Campaign paused",
  "Campaign launched",
  "External factor",
  "Other",
] as const;

export type WorklogActionType = (typeof WORKLOG_ACTION_TYPES)[number];

export const WORKLOG_SCOPES = [
  "account",
  "campaign",
  "ad group",
  "creative",
  "landing page",
  "other",
] as const;

export type WorklogScope = (typeof WORKLOG_SCOPES)[number];

export const WORKLOG_PLATFORMS: readonly {
  value: WorklogPlatform;
  label: string;
}[] = [
  { value: "all", label: "All Platforms" },
  { value: "google", label: "Google Ads" },
  { value: "meta", label: "Meta Ads" },
  { value: "tiktok", label: "TikTok Ads" },
  { value: "ga4", label: "Google Analytics 4" },
  { value: "bing", label: "Microsoft Advertising" },
  { value: "other", label: "Other" },
] as const;

/* Shared by the recommendation engine. These metrics no longer appear as
   required inputs in the worklog form. */
export const WORKLOG_EXPECTED_METRICS = [
  "spend",
  "impressions",
  "clicks",
  "ctr",
  "cpc",
  "registrations",
  "costPerRegistration",
  "purchases",
  "costPerPurchase",
  "conversionRate",
  "revenue",
  "roas",
] as const;
export type WorklogStatus = "draft" | "needs-review" | "approved";

export interface WorklogRecord {
  id: string;
  accountSlug: string;
  occurredOn: string;
  platform: WorklogPlatform;
  scope: WorklogScope;
  entityName: string;
  actionType: WorklogActionType;
  actionSummary: string;
  reasonOrHypothesis: string;
  status: WorklogStatus;
  createdBy: string;
  createdAt: string;
}

export interface WorklogDraft {
  accountSlug: string;
  occurredOn: string;
  platform: WorklogPlatform;
  scope: WorklogScope;
  entityName: string;
  actionType: WorklogActionType;
  actionSummary: string;
  reasonOrHypothesis: string;
  status: Exclude<WorklogStatus, "approved">;
}

export interface WorklogValidation {
  ok: boolean;
  errors: Record<string, string>;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Returns the calendar day for the account timezone, not the browser timezone. */
export function getWorklogDateKey(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone,
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type === "day" || part.type === "month" || part.type === "year")
      .map((part) => [part.type, part.value]),
  );

  return `${values.year}-${values.month}-${values.day}`;
}

/**
 * Validation lives next to the type so the API and the form agree. The form is
 * the only writer, but the API must never trust it.
 */
export function validateWorklogDraft(
  input: Partial<WorklogDraft>,
): WorklogValidation {
  const errors: Record<string, string> = {};

  if (!input.occurredOn || !DATE_PATTERN.test(input.occurredOn)) {
    errors.occurredOn = "Give the date the action happened, as YYYY-MM-DD.";
  }
  if (
    !input.platform ||
    !WORKLOG_PLATFORMS.some((platform) => platform.value === input.platform)
  ) {
    errors.platform = "Say which platform the action touched.";
  }
  if (!input.scope || !WORKLOG_SCOPES.includes(input.scope)) {
    errors.scope = "Choose what the action applied to.";
  }
  if (!input.entityName || input.entityName.trim().length < 2) {
    errors.entityName = "Name the campaign, ad group, or asset.";
  }
  if (
    !input.actionType ||
    !WORKLOG_ACTION_TYPES.includes(input.actionType)
  ) {
    errors.actionType = "Choose the kind of action.";
  }
  if (!input.actionSummary || input.actionSummary.trim().length < 8) {
    errors.actionSummary = "Describe what changed in a sentence.";
  }
  // The reason is what makes a worklog worth keeping: without it an entry
  // cannot explain a movement later.
  if (!input.reasonOrHypothesis || input.reasonOrHypothesis.trim().length < 8) {
    errors.reasonOrHypothesis = "State the reason or the hypothesis.";
  }
  return { ok: Object.keys(errors).length === 0, errors };
}

/**
 * Preview storage. Entries live in the running server only.
 *
 * The store hangs off globalThis on purpose: a page render and a route handler
 * are separate module instances in Next, so a plain module-level array is not
 * the same array in both. This keeps one process coherent. It still does not
 * survive a restart, and on a serverless host each instance gets its own copy,
 * which is why Supabase storage is the gate before this goes live.
 */
const globalStore = globalThis as typeof globalThis & {
  __slWorklogEntries?: WorklogRecord[];
};

const entries: WorklogRecord[] = (globalStore.__slWorklogEntries ??= []);

export function listWorklog(accountSlug: string): WorklogRecord[] {
  return entries
    .filter((entry) => entry.accountSlug === accountSlug)
    .toSorted((left, right) =>
      left.occurredOn < right.occurredOn ? 1 : -1,
    );
}

export function addWorklogEntry(
  draft: WorklogDraft,
  createdBy: string,
): WorklogRecord {
  const record: WorklogRecord = {
    ...draft,
    id: `worklog-${Date.now()}-${entries.length + 1}`,
    createdBy,
    createdAt: new Date().toISOString(),
  };

  entries.unshift(record);
  return record;
}

export function approveWorklogEntry(id: string): WorklogRecord | null {
  const entry = entries.find((item) => item.id === id);
  if (!entry) return null;
  entry.status = "approved";
  return entry;
}

/**
 * Maps stored records onto the shape the overview reads. Only approved
 * entries are ever mapped, so an unreviewed note cannot explain a movement.
 */
export function toWorklogEntries(
  records: readonly WorklogRecord[],
): WorklogEntry[] {
  return records
    .filter((record) => record.status === "approved")
    .map((record) => ({
      id: record.id,
      occurredAt: `${record.occurredOn}T09:00:00.000Z`,
      platform: record.platform,
      actionType: record.actionType,
      actionSummary: record.actionSummary,
      reasonOrHypothesis: record.reasonOrHypothesis,
      status: "approved" as const,
    }));
}

/** Only approved entries inside the window may explain a movement. */
export function approvedWorklogInRange(
  accountSlug: string,
  range: { start: string; end: string },
  platform: Platform,
): WorklogRecord[] {
  return listWorklog(accountSlug).filter(
    (entry) =>
      entry.status === "approved" &&
      entry.occurredOn >= range.start &&
      entry.occurredOn <= range.end &&
      (platform === "all" ||
        entry.platform === "all" ||
        entry.platform === platform),
  );
}
