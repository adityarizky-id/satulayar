import assert from "node:assert/strict";
import test from "node:test";

import {
  COLUMN_AXIS_INSET_PERCENT,
  COLUMN_HEIGHT,
  COLUMN_PADDING,
  COLUMN_WIDTH,
  bandDividerX,
  barRect,
  gridLinePercent,
  gridLineValue,
  layoutAxisBands,
  niceAxisMax,
  slotCentre,
  tooltipAnchor,
} from "../src/lib/dashboard/column-geometry";
import {
  smoothAreaPath,
  splitLineSegments,
} from "../src/components/charts/smooth-line";

test("the label track inset matches the plot inset", () => {
  // The HTML category labels sit under the SVG columns only while this holds.
  assert.equal(
    COLUMN_AXIS_INSET_PERCENT,
    (COLUMN_PADDING / COLUMN_WIDTH) * 100,
  );

  const count = 19;
  const trackStart = (COLUMN_AXIS_INSET_PERCENT / 100) * COLUMN_WIDTH;
  const trackWidth = COLUMN_WIDTH - trackStart * 2;

  for (const index of [0, 9, 18]) {
    const labelCentre = trackStart + (trackWidth / count) * (index + 0.5);
    assert.ok(
      Math.abs(labelCentre - slotCentre(index, count)) < 1e-9,
      `label ${index} drifted from its column`,
    );
  }
});

test("columns stay inside the plot area", () => {
  const count = 19;
  assert.ok(slotCentre(0, count) > COLUMN_PADDING);
  assert.ok(slotCentre(count - 1, count) < COLUMN_WIDTH - COLUMN_PADDING);
});

test("the tooltip anchors on the column centre, not the chart edge", () => {
  const count = 19;
  // The old anchor was index / (count - 1), which pinned the first column to
  // the very left edge of the panel instead of to the bar it describes.
  assert.equal(tooltipAnchor(0, count), slotCentre(0, count) / COLUMN_WIDTH);
  assert.ok(tooltipAnchor(0, count) > 0);
  assert.ok(tooltipAnchor(count - 1, count) < 1);
  assert.equal(tooltipAnchor(0, 0), 0.5);
});

test("a zero ends at the baseline with no height", () => {
  const rect = barRect(0, 1000, 3, 0, 12, 1);
  assert.equal(rect.height, 0);
  assert.equal(rect.y, COLUMN_HEIGHT - COLUMN_PADDING);
});

test("bar height is proportional and never leaves the plot", () => {
  const half = barRect(500, 1000, 0, 0, 12, 1);
  const full = barRect(1000, 1000, 0, 0, 12, 1);
  assert.equal(half.height, full.height / 2);
  assert.equal(full.y, COLUMN_PADDING);

  // Guards a shared-scale chart where one plot is handed another's maximum.
  const over = barRect(4000, 1000, 0, 0, 12, 1);
  assert.equal(over.height, full.height);
  assert.ok(over.y >= COLUMN_PADDING);
});

test("bar geometry follows a shortened plot", () => {
  const short = barRect(1000, 1000, 0, 0, 12, 1, 150);
  assert.equal(short.y, COLUMN_PADDING);
  assert.equal(short.height, 150 - COLUMN_PADDING * 2);
});

test("series in a group sit side by side without overlapping", () => {
  const first = barRect(100, 100, 4, 0, 7, 2);
  const second = barRect(100, 100, 4, 1, 7, 2);
  assert.equal(second.x, first.x + first.width);
  assert.ok(
    Math.abs((first.x + second.x + second.width) / 2 - slotCentre(4, 7)) < 1e-9,
    "the pair should straddle the slot centre",
  );
});

test("gridlines run from the axis maximum down to zero", () => {
  assert.equal(gridLineValue(0, 4000), 4000);
  assert.equal(gridLineValue(1, 4000), 0);
  assert.equal(gridLineValue(0.25, 4000), 3000);

  assert.equal(gridLinePercent(0), (COLUMN_PADDING / COLUMN_HEIGHT) * 100);
  assert.equal(
    gridLinePercent(1),
    ((COLUMN_HEIGHT - COLUMN_PADDING) / COLUMN_HEIGHT) * 100,
  );
});

test("axis maxima round up to figures a reader can quarter", () => {
  assert.equal(niceAxisMax(47_382.19), 50_000);
  assert.equal(niceAxisMax(1200), 2000);
  assert.equal(niceAxisMax(0.34), 0.5);
  assert.equal(niceAxisMax(1000), 1000);
  // Never below the data: a bar must not be able to exceed its own axis.
  for (const value of [1, 7, 99, 4321, 68_000, 0.07]) {
    assert.ok(niceAxisMax(value) >= value, `${value} exceeded its axis`);
  }
});

test("an empty or broken maximum still gives a usable axis", () => {
  assert.equal(niceAxisMax(0), 1);
  assert.equal(niceAxisMax(-5), 1);
  assert.equal(niceAxisMax(Number.NaN), 1);
});

test("year bands cover their months and start where the previous one ends", () => {
  const bands = layoutAxisBands(
    [
      { label: "2025", span: 12 },
      { label: "2026", span: 7 },
    ],
    19,
  );

  assert.equal(bands.length, 2);
  assert.equal(bands[0].leftPercent, 0);
  assert.equal(bands[0].startSlot, 0);
  assert.equal(bands[1].startSlot, 12);
  assert.equal(
    bands[0].leftPercent + bands[0].widthPercent,
    bands[1].leftPercent,
  );
  assert.equal(bands[1].leftPercent + bands[1].widthPercent, 100);
});

test("bands are trimmed to the categories that exist", () => {
  const bands = layoutAxisBands(
    [
      { label: "2025", span: 12 },
      { label: "2026", span: 7 },
    ],
    12,
  );

  assert.equal(bands.length, 1);
  assert.equal(bands[0].widthPercent, 100);
  assert.deepEqual(layoutAxisBands([{ label: "2026", span: 7 }], 0), []);
});

test("the band divider lands on the boundary between two columns", () => {
  const count = 19;
  const divider = bandDividerX(12, count);
  assert.ok(divider > slotCentre(11, count));
  assert.ok(divider < slotCentre(12, count));
});

test("an area path keeps the observed line and closes on the zero baseline", () => {
  assert.equal(
    smoothAreaPath(
      [
        { x: 10, y: 20 },
        { x: 30, y: 40 },
      ],
      100,
      0,
    ),
    "M 10.00 20.00 L 30.00 40.00 L 30.00 100.00 L 10.00 100.00 Z",
  );
});

test("missing observations split trend areas instead of bridging the gap", () => {
  const first = { x: 10, y: 20 };
  const second = { x: 30, y: 40 };
  const third = { x: 40, y: 30 };

  assert.deepEqual(splitLineSegments([first, null, second, third]), [
    [first],
    [second, third],
  ]);
});
