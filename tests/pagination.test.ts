import assert from "node:assert/strict";
import test from "node:test";

import { paginate } from "../src/components/dashboard/pagination";

test("a page slice never runs past the end of the list", () => {
  const items = Array.from({ length: 23 }, (_, index) => index);

  assert.deepEqual(paginate(items, 0, 10).rows.length, 10);
  assert.deepEqual(paginate(items, 2, 10).rows, [20, 21, 22]);
  assert.equal(paginate(items, 2, 10).pageCount, 3);
});

test("a page beyond the end falls back to the last page, not to nothing", () => {
  // This is what happens when a filter shrinks the list while the reader is
  // on page 5: without the clamp they get an empty table and assume no data.
  const items = Array.from({ length: 12 }, (_, index) => index);
  const state = paginate(items, 9, 10);

  assert.equal(state.safePage, 1);
  assert.deepEqual(state.rows, [10, 11]);
});

test("a negative page is clamped rather than reversing the slice", () => {
  const state = paginate([1, 2, 3], -4, 2);

  assert.equal(state.safePage, 0);
  assert.deepEqual(state.rows, [1, 2]);
});

test("an empty list reports one page and no rows", () => {
  const state = paginate([], 0, 10);

  assert.equal(state.pageCount, 1);
  assert.equal(state.safePage, 0);
  assert.deepEqual(state.rows, []);
});

test("every item appears exactly once across the pages", () => {
  const items = Array.from({ length: 47 }, (_, index) => index);
  const pageSize = 7;
  const { pageCount } = paginate(items, 0, pageSize);
  const seen: number[] = [];

  for (let page = 0; page < pageCount; page += 1) {
    seen.push(...paginate(items, page, pageSize).rows);
  }

  assert.deepEqual(seen, items);
});
