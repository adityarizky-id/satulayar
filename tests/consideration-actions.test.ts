import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveConsiderationActions,
  type GoogleConversionAction,
} from "../src/lib/connectors/google-ads-api-client";

/**
 * Consideration signals are resolved by name rather than by a configured id,
 * so that mapping a new account is an ads-side task: create the action with
 * the agreed name and the metric appears, with no deploy.
 *
 * The fixtures below are shapes that mirror live Google Ads accounts (IDs are synthetic), which
 * is where each of these rules came from.
 */

function action(
  overrides: Partial<GoogleConversionAction> & { name: string },
): GoogleConversionAction {
  return {
    id: overrides.id ?? "1",
    resourceName: `customers/1/conversionActions/${overrides.id ?? "1"}`,
    category: "PAGE_VIEW",
    type: "WEBPAGE",
    status: "ENABLED",
    includedInConversionsMetric: false,
    ...overrides,
  };
}

test("the page view and dwell actions are told apart by name", () => {
  // Kopi Senja Nusantara carries both, and they share a category and a type. Matching
  // on category alone would sum a page-load count with a 60-second dwell
  // count and report more landings than there were clicks.
  const { byField } = resolveConsiderationActions([
    action({ id: "9000000013", name: "Website – Page View (Loaded)" }),
    action({ id: "9000000011", name: "Time on Site - 60 Seconds" }),
  ]);

  assert.equal(byField.get("landingPageViews")?.id, "9000000013");
  assert.equal(byField.get("engagedVisits")?.id, "9000000011");
});

test("a Business Profile action is not a landing from an ad", () => {
  // Accounts with a Business Profile carry "Local actions - Website visits", which
  // is category PAGE_VIEW but type GOOGLE_HOSTED: a click through from a
  // Business Profile listing, not a landing from a paid click.
  const { byField } = resolveConsiderationActions([
    action({
      id: "9000000015",
      name: "Local actions - Website visits",
      type: "GOOGLE_HOSTED",
    }),
  ]);

  assert.equal(byField.has("landingPageViews"), false);
});

test("a name is matched past dash and case differences", () => {
  // The en dash in the agreed name is not what gets typed in every account.
  const { byField } = resolveConsiderationActions([
    action({ id: "9", name: "website - page view (loaded)" }),
  ]);

  assert.equal(byField.get("landingPageViews")?.id, "9");
});

test("a mislabelled action is not adopted on its name alone", () => {
  // An account can have an action called "Registration" whose category is
  // PAGE_VIEW. The reverse trap is one named for a page view that is not one;
  // category and type have to agree with the name before it is used.
  const { byField } = resolveConsiderationActions([
    action({
      id: "5",
      name: "Website – Page View (Loaded)",
      category: "SIGNUP",
    }),
  ]);

  assert.equal(byField.has("landingPageViews"), false);
});

test("a paused action is not read", () => {
  const { byField } = resolveConsiderationActions([
    action({ id: "6", name: "Add to basket", category: "ADD_TO_CART", status: "REMOVED" }),
  ]);

  assert.equal(byField.has("addToBaskets"), false);
});

test("two actions with the same name are reported rather than guessed", () => {
  const { byField, problems } = resolveConsiderationActions([
    action({ id: "1", name: "Add to basket", category: "ADD_TO_CART" }),
    action({ id: "2", name: "Add to basket", category: "ADD_TO_CART" }),
  ]);

  // Summing them double counts and picking one is a guess, so the field stays
  // unmapped and the ambiguity is surfaced instead.
  assert.equal(byField.has("addToBaskets"), false);
  assert.equal(problems.length, 1);
  assert.match(String(problems[0]), /addToBaskets/);
});

test("an account with nothing mapped resolves nothing and complains about nothing", () => {
  // A common shape. An unmapped account is the normal starting state, not an
  // error: the metrics report as not measured and the operator is told once,
  // by the connector's own warning, not by a problem per action.
  const { byField, problems } = resolveConsiderationActions([
    action({ id: "3", name: "New Registration", category: "SIGNUP" }),
    action({ id: "4", name: "Purchase", category: "PURCHASE" }),
  ]);

  assert.equal(byField.size, 0);
  assert.deepEqual(problems, []);
});

test("the basket action is matched on its own category", () => {
  const { byField } = resolveConsiderationActions([
    action({ id: "9000000012", name: "Add to basket", category: "ADD_TO_CART" }),
  ]);

  assert.equal(byField.get("addToBaskets")?.id, "9000000012");
});
