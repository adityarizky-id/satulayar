import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  AUDIENCE_EXPORT_PRESETS,
  buildAudienceExportCsv,
  csvCell,
  mapRfmSegment,
  normalizeEmail,
  normalizePhoneE164,
  normalizeZip,
  splitDisplayName,
  toAudienceRecords,
  type AudienceCustomerRecord,
} from "@/lib/dashboard/audience-exporter";
import type { CustomerRfmRow, RfmSegmentKey } from "@/lib/store/types";

/**
 * Every value below is synthetic. Real customer rows are PII and must never
 * reach a test fixture, a log, or version control.
 */
function record(
  overrides: Partial<AudienceCustomerRecord> = {},
): AudienceCustomerRecord {
  return {
    email: "buyer@example.test",
    phone: "+6281234567890",
    firstName: "Alex",
    lastName: "Stone",
    zip: "S1 2HB",
    country: "ID",
    purchaseValue: 1250.5,
    orderCount: 4,
    cohortSegment: "Champions",
    ...overrides,
  };
}

/** Splits a CSV line back into raw cell values, undoing RFC 4180 quoting. */
function cells(line: string): string[] {
  return (line.match(/"(?:[^"]|"")*"/g) ?? []).map((cell) =>
    cell.slice(1, -1).replace(/""/g, '"'),
  );
}

test("the Meta preset emits the documented value-based column order", () => {
  const result = buildAudienceExportCsv([record()], {
    preset: "meta-value-based",
    currency: "GBP",
  });
  const [header, row] = result.csv.split("\r\n");

  assert.deepEqual(cells(header), [
    "email",
    "phone",
    "fn",
    "ln",
    "zip",
    "country",
    "value",
    "cohort_segment",
  ]);
  assert.deepEqual(cells(row), [
    "buyer@example.test",
    "+6281234567890",
    "alex",
    "stone",
    "S1 2HB",
    "ID",
    "1250.50",
    "Champions",
  ]);
  assert.equal(result.rowCount, 1);
  assert.equal(result.currency, "GBP");
});

test("the Google preset emits its own headers, with country before zip", () => {
  const result = buildAudienceExportCsv([record()], {
    preset: "google-customer-match",
    currency: "GBP",
  });
  const [header, row] = result.csv.split("\r\n");

  assert.deepEqual(cells(header), [
    "Email",
    "Phone",
    "First Name",
    "Last Name",
    "Country",
    "Zip",
    "Value",
    "Orders",
    "Segment",
  ]);
  // Orders travels with the row so a value-based list can weight frequency.
  assert.equal(cells(row)[7], "4");
});

test("the raw cohort preset carries all nine analysis columns", () => {
  const result = buildAudienceExportCsv([record()], {
    preset: "full-cohort-analytics",
    currency: "GBP",
  });
  const header = cells(result.csv.split("\r\n")[0]);

  assert.deepEqual(header, [
    "email",
    "phone",
    "first_name",
    "last_name",
    "zip",
    "country",
    "purchase_value",
    "order_count",
    "cohort_segment",
  ]);
  assert.equal(header.length, 9);
});

test("email is trimmed and lower-cased before it is written or hashed", () => {
  assert.equal(normalizeEmail("  Buyer@Example.TEST  "), "buyer@example.test");

  const result = buildAudienceExportCsv(
    [record({ email: "  Buyer@Example.TEST " })],
    { preset: "meta-value-based", currency: "GBP" },
  );
  assert.equal(cells(result.csv.split("\r\n")[1])[0], "buyer@example.test");
});

test("national numbers reach E.164 for every market the demo brands advertise in", () => {
  assert.equal(normalizePhoneE164("0812-3456-7890", "ID"), "+6281234567890");
  assert.equal(normalizePhoneE164("012-345 6789", "MY"), "+60123456789");
  // Singapore numbers carry no trunk zero.
  assert.equal(normalizePhoneE164("9123 4567", "SG"), "+6591234567");
});

test("an already-international number is preserved in either notation", () => {
  assert.equal(normalizePhoneE164("+62 812 3456 7890", "ID"), "+6281234567890");
  assert.equal(normalizePhoneE164("0062 812 3456 7890", ""), "+6281234567890");
});

test("a national number without a country is refused, not guessed", () => {
  // Prefixing a guessed dialling code produces a real number belonging to
  // someone else, which is worse than an empty cell.
  assert.equal(normalizePhoneE164("0812 3456 7890", ""), "");
  assert.equal(normalizePhoneE164("not-a-number", "ID"), "");
  assert.equal(normalizePhoneE164(null, "ID"), "");
});

test("postal codes keep their canonical spacing and case", () => {
  assert.equal(normalizeZip(" s1  2hb "), "S1 2HB");
  assert.equal(normalizeZip("10115"), "10115");
  assert.equal(normalizeZip(null), "");
});

test("value keeps two decimals and orders stay whole", () => {
  const result = buildAudienceExportCsv(
    [record({ purchaseValue: 1250.5, orderCount: 4.9 })],
    { preset: "full-cohort-analytics", currency: "GBP" },
  );
  const row = cells(result.csv.split("\r\n")[1]);

  assert.equal(row[6], "1250.50");
  assert.equal(row[7], "4");
});

test("a record with no email and no usable phone is dropped and reported", () => {
  const result = buildAudienceExportCsv(
    [record(), record({ email: "  ", phone: "0812 3456 7890", country: null })],
    { preset: "meta-value-based", currency: "GBP" },
  );

  assert.equal(result.rowCount, 1);
  assert.equal(result.droppedUnmatchableRows, 1);
  assert.equal(
    result.warnings.some((warning) => /neither an email nor a usable phone/.test(warning)),
    true,
  );
});

test("an identifier that is empty for every row is surfaced as coverage, not hidden", () => {
  const result = buildAudienceExportCsv(
    [record({ zip: null }), record({ zip: null, email: "second@example.test" })],
    { preset: "meta-value-based", currency: "GBP" },
  );
  const zip = result.coverage.find((entry) => entry.column === "zip");
  const email = result.coverage.find((entry) => entry.column === "email");

  assert.equal(zip?.coveragePercent, 0);
  assert.equal(email?.coveragePercent, 100);
  assert.equal(
    result.warnings.some((warning) => /zip is empty for every row/.test(warning)),
    true,
  );
});

test("a cell that would run as a spreadsheet formula is neutralised", () => {
  // A customer-supplied name is attacker-controlled text; Excel and Sheets
  // execute a leading =, +, - or @ on open.
  assert.equal(csvCell("=HYPERLINK(1)"), '"\'=HYPERLINK(1)"');
  assert.equal(csvCell("@sum"), '"\'@sum"');
  assert.equal(csvCell("-2+3"), '"\'-2+3"');
  assert.equal(csvCell("Stone"), '"Stone"');
  assert.equal(csvCell('Say "hi"'), '"Say ""hi"""');
  // A phone number is not a formula. Guarding it would corrupt every E.164
  // cell in the file and quietly wreck the match rate.
  assert.equal(csvCell("+6281234567890"), '"+6281234567890"');
  assert.equal(csvCell("-15.5"), '"-15.5"');

  const result = buildAudienceExportCsv([record({ lastName: "=cmd|calc" })], {
    preset: "meta-value-based",
    currency: "GBP",
  });
  assert.match(result.csv, /"'=cmd\|calc"/);
});

test("sha256 mode hashes the identity fields and leaves the rest readable", () => {
  const result = buildAudienceExportCsv([record()], {
    preset: "google-customer-match",
    currency: "GBP",
    hash: "sha256",
  });
  const row = cells(result.csv.split("\r\n")[1]);
  const expectedEmail = createHash("sha256")
    .update("buyer@example.test", "utf8")
    .digest("hex");

  assert.equal(result.hashed, true);
  assert.equal(row[0], expectedEmail);
  assert.match(row[1], /^[a-f0-9]{64}$/);
  assert.match(row[2], /^[a-f0-9]{64}$/);
  // Google matches on Country and Zip in clear; hashing them breaks the list.
  assert.equal(row[4], "ID");
  assert.equal(row[5], "S1 2HB");
  assert.equal(row[6], "1250.50");
  assert.equal(row[8], "Champions");
});

test("the analysis export refuses hashing, because a hashed file cannot be read", () => {
  assert.throws(
    () =>
      buildAudienceExportCsv([record()], {
        preset: "full-cohort-analytics",
        currency: "GBP",
        hash: "sha256",
      }),
    /cannot be hashed/,
  );
  assert.deepEqual(
    AUDIENCE_EXPORT_PRESETS["full-cohort-analytics"].hashableColumns,
    [],
  );
});

test("a cohort filter narrows the list and counts what it removed", () => {
  const result = buildAudienceExportCsv(
    [
      record(),
      record({ email: "risk@example.test", cohortSegment: "At Risk" }),
      record({ email: "gone@example.test", cohortSegment: "Churned" }),
    ],
    {
      preset: "meta-value-based",
      currency: "GBP",
      segments: ["Champions", "At Risk"],
    },
  );

  assert.equal(result.rowCount, 2);
  assert.equal(result.filteredOutRows, 1);
});

test("every RFM segment maps onto one of the four cohort labels", () => {
  const keys: RfmSegmentKey[] = [
    "champions",
    "loyal",
    "active",
    "promising",
    "new",
    "needsAttention",
    "atRisk",
    "almostLost",
    "previouslyLoyal",
    "dormant",
  ];
  const mapped = new Set(keys.map(mapRfmSegment));

  assert.equal(keys.every((key) => Boolean(mapRfmSegment(key))), true);
  assert.deepEqual(
    [...mapped].toSorted(),
    ["At Risk", "Champions", "Churned", "Loyal Customers"],
  );
});

test("a display name is split without losing a compound surname", () => {
  assert.deepEqual(splitDisplayName("Alex Stone"), {
    firstName: "Alex",
    lastName: "Stone",
  });
  assert.deepEqual(splitDisplayName("Maria del Carmen Garcia"), {
    firstName: "Maria",
    lastName: "del Carmen Garcia",
  });
  assert.deepEqual(splitDisplayName("  Prince  "), {
    firstName: "Prince",
    lastName: "",
  });
  assert.deepEqual(splitDisplayName(null), { firstName: "", lastName: "" });
});

test("store RFM rows adapt cleanly, and a blank field stays visibly blank", () => {
  const customer = {
    customerId: "cust-1",
    name: "Alex Stone",
    firstName: "Alex",
    lastName: "Stone",
    email: "Buyer@Example.TEST",
    phone: "+6281234567890",
    zip: "S1 2HB",
    country: "ID",
    company: "Example Ltd",
    segmentKey: "champions" as RfmSegmentKey,
    segmentLabel: "Champions",
    recencyDays: 12,
    lastOrderDate: "2026-09-01",
    frequency: 4,
    monetary: 1250.5,
    aov: 312.63,
    topCategory: "Batik",
    statusTag: "Priority",
    recencyScore: 5,
    frequencyScore: 5,
    monetaryScore: 5,
  } satisfies CustomerRfmRow;

  const [adapted] = toAudienceRecords([customer], { country: "ID" });

  assert.equal(adapted.firstName, "Alex");
  assert.equal(adapted.lastName, "Stone");
  assert.equal(adapted.purchaseValue, 1250.5);
  assert.equal(adapted.orderCount, 4);
  assert.equal(adapted.cohortSegment, "Champions");
  assert.equal(adapted.phone, "+6281234567890");
  assert.equal(adapted.zip, "S1 2HB");

  // A row that predates the extended customer schema still exports a usable
  // name from the combined field, and its blank identifiers are reported as
  // coverage rather than invented.
  const legacy = {
    ...customer,
    firstName: "",
    lastName: "",
    phone: "",
    zip: "",
    country: "",
  } satisfies CustomerRfmRow;
  const [adaptedLegacy] = toAudienceRecords([legacy]);
  assert.equal(adaptedLegacy.firstName, "Alex");
  assert.equal(adaptedLegacy.lastName, "Stone");
  assert.equal(adaptedLegacy.country, null);

  const result = buildAudienceExportCsv(toAudienceRecords([legacy]), {
    preset: "google-customer-match",
    currency: "GBP",
  });
  assert.equal(
    result.coverage.find((entry) => entry.column === "phone")?.coveragePercent,
    0,
  );
  assert.equal(
    result.coverage.find((entry) => entry.column === "email")?.coveragePercent,
    100,
  );
});

test("the export is CRLF-delimited and every cell is quoted", () => {
  const result = buildAudienceExportCsv([record(), record()], {
    preset: "meta-value-based",
    currency: "GBP",
  });
  const lines = result.csv.split("\r\n");

  assert.equal(lines.length, 3);
  for (const line of lines) {
    assert.match(line, /^".*"$/);
    assert.equal(cells(line).length, 8);
  }
});
