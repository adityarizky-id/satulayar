import assert from "node:assert/strict";
import test from "node:test";

import {
  addWorklogEntry,
  approvedWorklogInRange,
  approveWorklogEntry,
  getWorklogDateKey,
  listWorklog,
  toWorklogEntries,
  validateWorklogDraft,
  WORKLOG_ACTION_TYPES,
  WORKLOG_PLATFORMS,
  WORKLOG_SCOPES,
  type WorklogDraft,
} from "../src/lib/dashboard/worklog";

function draft(overrides: Partial<WorklogDraft> = {}): WorklogDraft {
  return {
    accountSlug: "kopi-senja",
    occurredOn: "2026-07-08",
    platform: "google",
    scope: "campaign",
    entityName: "ID | Search | Coffee Core",
    actionType: "Budget change",
    actionSummary: "Cut the daily budget from 60 to 40 and moved it to Search.",
    reasonOrHypothesis:
      "Cost per order sat above target for nine days while Search was capped.",
    status: "needs-review",
    ...overrides,
  };
}

test("the form captures what, when, where, and why", () => {
  const validation = validateWorklogDraft(draft());

  assert.equal(validation.ok, true);
  assert.equal(WORKLOG_ACTION_TYPES.length > 5, true);
});

test("every worklog classification dropdown includes Other", () => {
  assert.equal(WORKLOG_PLATFORMS.at(-1)?.value, "other");
  assert.equal(WORKLOG_SCOPES.at(-1), "other");
  assert.equal(WORKLOG_ACTION_TYPES.at(-1), "Other");
  assert.equal(validateWorklogDraft(draft({ platform: "other" })).ok, true);
  assert.equal(validateWorklogDraft(draft({ scope: "other" })).ok, true);
  assert.equal(validateWorklogDraft(draft({ actionType: "Other" })).ok, true);
});

test("an entry without a reason is rejected, because it explains nothing later", () => {
  const validation = validateWorklogDraft(draft({ reasonOrHypothesis: "n/a" }));

  assert.equal(validation.ok, false);
  assert.match(validation.errors.reasonOrHypothesis ?? "", /reason|hypothesis/i);
});

test("every required field is checked, not just the first one", () => {
  const validation = validateWorklogDraft({});

  assert.deepEqual(
    Object.keys(validation.errors).toSorted(),
    [
      "actionSummary",
      "actionType",
      "entityName",
      "occurredOn",
      "platform",
      "reasonOrHypothesis",
      "scope",
    ],
  );
});

test("a malformed date is rejected before it reaches storage", () => {
  assert.equal(validateWorklogDraft(draft({ occurredOn: "08/07/2026" })).ok, false);
  assert.equal(validateWorklogDraft(draft({ occurredOn: "2026-07-08" })).ok, true);
});

test("a saved entry starts unapproved and stays out of the overview", () => {
  const saved = addWorklogEntry(draft(), "editor@example.test");

  assert.equal(saved.status, "needs-review");
  assert.equal(toWorklogEntries([saved]).length, 0);
  assert.equal(
    approvedWorklogInRange(
      "kopi-senja",
      { start: "2026-07-01", end: "2026-07-14" },
      "all",
    ).some((entry) => entry.id === saved.id),
    false,
  );
});

test("approval is what lets an entry explain a movement", () => {
  const saved = addWorklogEntry(
    draft({ entityName: "Approval path campaign" }),
    "editor@example.test",
  );
  const approved = approveWorklogEntry(saved.id);

  assert.equal(approved?.status, "approved");
  assert.equal(toWorklogEntries([approved!]).length, 1);
  assert.equal(
    approvedWorklogInRange(
      "kopi-senja",
      { start: "2026-07-01", end: "2026-07-14" },
      "google",
    ).some((entry) => entry.id === saved.id),
    true,
  );
});

test("an entry never leaks into another brand or another period", () => {
  const other = addWorklogEntry(
    draft({ accountSlug: "batik-lestari", entityName: "HR campaign" }),
    "editor@example.test",
  );
  approveWorklogEntry(other.id);

  assert.equal(
    listWorklog("kopi-senja").some((entry) => entry.id === other.id),
    false,
  );
  assert.equal(
    approvedWorklogInRange(
      "batik-lestari",
      { start: "2026-08-01", end: "2026-08-14" },
      "all",
    ).length,
    0,
  );
});

test("a Meta filter never shows a Google-only action", () => {
  const googleOnly = addWorklogEntry(
    draft({ entityName: "Google only", platform: "google" }),
    "editor@example.test",
  );
  approveWorklogEntry(googleOnly.id);

  const metaView = approvedWorklogInRange(
    "kopi-senja",
    { start: "2026-07-01", end: "2026-07-14" },
    "meta",
  );

  assert.equal(metaView.some((entry) => entry.id === googleOnly.id), false);
});

test("the mapped entry keeps the fields the overview reads", () => {
  const saved = addWorklogEntry(
    draft({ entityName: "Mapping check" }),
    "editor@example.test",
  );
  approveWorklogEntry(saved.id);
  const [entry] = toWorklogEntries([{ ...saved, status: "approved" }]);

  assert.equal(entry?.actionType, "Budget change");
  assert.match(entry?.occurredAt ?? "", /^2026-07-08T/);
  assert.equal(entry?.status, "approved");
});

test("the form date follows the account timezone instead of the browser", () => {
  const instant = new Date("2026-09-12T23:30:00.000Z");

  assert.equal(getWorklogDateKey(instant, "Europe/London"), "2026-09-13");
  assert.equal(getWorklogDateKey(instant, "America/New_York"), "2026-09-12");
});
