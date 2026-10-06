import assert from "node:assert/strict";
import test from "node:test";

import { formatSyncTimestamp } from "../src/components/dashboard/clocks";
import { ACCOUNT_OPTIONS } from "../src/lib/dashboard/accounts";

const SUMMER_INSTANT = "2026-08-05T21:17:00.000Z";
const WINTER_INSTANT = "2026-01-15T21:17:00.000Z";

test("a sync time is shown in the account timezone with its zone label", () => {
  const london = formatSyncTimestamp(SUMMER_INSTANT, "Europe/London");
  const madrid = formatSyncTimestamp(SUMMER_INSTANT, "Europe/Madrid");

  // Same instant, two accounts: the wall-clock reading has to differ.
  assert.notEqual(london, madrid);
  assert.match(london, /22:17/);
  assert.match(madrid, /23:17/);
  assert.match(london, /GMT\+1|BST/);
});

test("the zone label follows daylight saving instead of being hard-coded", () => {
  const summer = formatSyncTimestamp(SUMMER_INSTANT, "Europe/London");
  const winter = formatSyncTimestamp(WINTER_INSTANT, "Europe/London");

  assert.match(summer, /22:17/);
  assert.match(winter, /21:17/);
  assert.notEqual(
    summer.replace(/[\d:, ]/g, ""),
    winter.replace(/[\d:, ]/g, ""),
  );
});

test("every brand carries a timezone the formatter can actually use", () => {
  for (const account of ACCOUNT_OPTIONS) {
    assert.doesNotThrow(() =>
      formatSyncTimestamp(SUMMER_INSTANT, account.timezone),
    );
    // A qualifier appended to the id would break Intl, so ids must stay clean.
    assert.doesNotMatch(account.timezone, /[·,]/);
  }
});
