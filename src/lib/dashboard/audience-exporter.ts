import { createHash } from "node:crypto";

import type { Currency } from "@/lib/dashboard/types";
import type { CustomerRfmRow, RfmSegmentKey } from "@/lib/store/types";

/**
 * Value-based customer-match export.
 *
 * Everything here is pure: records in, CSV text out. It never reads a database,
 * never writes a file, and never logs a row - the content is customer PII, so
 * the only place it may exist is the body of an authorised download. The caller
 * owns the permission check and the legal basis for the upload; this module
 * owns the shape being correct and never silently degrading an identifier.
 */

/** Markets the pilot advertises in. Anything else is refused, not guessed. */
export const SUPPORTED_AUDIENCE_COUNTRIES = ["ID", "MY", "SG"] as const;

export type AudienceCountry = (typeof SUPPORTED_AUDIENCE_COUNTRIES)[number];

/** Dialling codes used to lift a national number to E.164. */
const COUNTRY_DIAL_CODES: Record<AudienceCountry, string> = {
  ID: "62",
  MY: "60",
  SG: "65",
};

/**
 * The four segments the brief names. The store RFM model is finer grained, so
 * `mapRfmSegment` folds its ten keys into these. The mapping is written out
 * rather than inferred from segment order.
 */
export type AudienceCohortSegment =
  | "Champions"
  | "Loyal Customers"
  | "At Risk"
  | "Churned";

const RFM_SEGMENT_TO_COHORT: Record<RfmSegmentKey, AudienceCohortSegment> = {
  champions: "Champions",
  loyal: "Loyal Customers",
  active: "Loyal Customers",
  promising: "Loyal Customers",
  new: "Loyal Customers",
  needsAttention: "At Risk",
  atRisk: "At Risk",
  almostLost: "At Risk",
  previouslyLoyal: "At Risk",
  dormant: "Churned",
};

export function mapRfmSegment(key: RfmSegmentKey): AudienceCohortSegment {
  return RFM_SEGMENT_TO_COHORT[key];
}

/** One customer, already resolved from whichever store source supplied it. */
export interface AudienceCustomerRecord {
  email?: string | null;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  /** Postal code as the customer gave it; case and spacing normalised only. */
  zip?: string | null;
  country?: string | null;
  /** Lifetime value in the account currency. Never converted. */
  purchaseValue: number;
  /** Completed orders. A basket that was never dispatched is not an order. */
  orderCount: number;
  cohortSegment: AudienceCohortSegment;
}

export type AudienceExportPresetId =
  | "meta-value-based"
  | "google-customer-match"
  | "full-cohort-analytics";

export type AudienceColumnKey =
  | "email"
  | "phone"
  | "firstName"
  | "lastName"
  | "zip"
  | "country"
  | "purchaseValue"
  | "orderCount"
  | "cohortSegment";

interface AudienceExportPreset {
  id: AudienceExportPresetId;
  label: string;
  /** Column order and header text exactly as the destination expects it. */
  columns: { key: AudienceColumnKey; header: string }[];
  /**
   * Columns the destination matches on. A row carrying none of them is dropped:
   * it would take up a list slot while being unmatchable.
   */
  identifierColumns: AudienceColumnKey[];
  /** Fields the platform expects SHA-256 hashed when `hash: "sha256"`. */
  hashableColumns: AudienceColumnKey[];
  notes: string;
}

export const AUDIENCE_EXPORT_PRESETS: Record<AudienceExportPresetId, AudienceExportPreset> = {
  "meta-value-based": {
    id: "meta-value-based",
    label: "Meta value-based custom audience",
    columns: [
      { key: "email", header: "email" },
      { key: "phone", header: "phone" },
      { key: "firstName", header: "fn" },
      { key: "lastName", header: "ln" },
      { key: "zip", header: "zip" },
      { key: "country", header: "country" },
      { key: "purchaseValue", header: "value" },
      { key: "cohortSegment", header: "cohort_segment" },
    ],
    identifierColumns: ["email", "phone"],
    hashableColumns: ["email", "phone", "firstName", "lastName", "zip"],
    notes:
      "The value column is lifetime value in one currency. Meta sets the currency on the audience, not per row, so a mixed-currency export is refused.",
  },
  "google-customer-match": {
    id: "google-customer-match",
    label: "Google Customer Match",
    columns: [
      { key: "email", header: "Email" },
      { key: "phone", header: "Phone" },
      { key: "firstName", header: "First Name" },
      { key: "lastName", header: "Last Name" },
      { key: "country", header: "Country" },
      { key: "zip", header: "Zip" },
      { key: "purchaseValue", header: "Value" },
      { key: "orderCount", header: "Orders" },
      { key: "cohortSegment", header: "Segment" },
    ],
    identifierColumns: ["email", "phone"],
    // Google hashes the identity fields but needs Country and Zip in clear.
    hashableColumns: ["email", "phone", "firstName", "lastName"],
    notes:
      "Google requires First Name and Last Name to travel with Country and Zip; a name without them is ignored for matching.",
  },
  "full-cohort-analytics": {
    id: "full-cohort-analytics",
    label: "Full cohort analytics (raw)",
    columns: [
      { key: "email", header: "email" },
      { key: "phone", header: "phone" },
      { key: "firstName", header: "first_name" },
      { key: "lastName", header: "last_name" },
      { key: "zip", header: "zip" },
      { key: "country", header: "country" },
      { key: "purchaseValue", header: "purchase_value" },
      { key: "orderCount", header: "order_count" },
      { key: "cohortSegment", header: "cohort_segment" },
    ],
    identifierColumns: ["email", "phone"],
    hashableColumns: [],
    notes:
      "For LTV and AOV analysis in a spreadsheet. Never hashed, because hashed values cannot be analysed - treat the file as customer PII.",
  },
};

export interface AudienceExportOptions {
  preset: AudienceExportPresetId;
  /** Reporting currency of the values. Recorded, never converted. */
  currency: Currency;
  /**
   * `sha256` for API uploads, which require pre-hashed identifiers. The
   * spreadsheet preset refuses hashing, because a hashed file cannot be read.
   */
  hash?: "none" | "sha256";
  /** Optional cohort filter, applied before the identifier check. */
  segments?: AudienceCohortSegment[];
}

export interface AudienceExportColumnCoverage {
  column: AudienceColumnKey;
  header: string;
  populatedRows: number;
  coveragePercent: number;
}

export interface AudienceExportResult {
  csv: string;
  presetId: AudienceExportPresetId;
  currency: Currency;
  hashed: boolean;
  rowCount: number;
  /** Records dropped for carrying no identifier the destination can match. */
  droppedUnmatchableRows: number;
  /** Records removed by the cohort filter. */
  filteredOutRows: number;
  /**
   * Per-column fill rate. An export whose `phone` or `zip` is 0% still uploads,
   * but its match rate will be worse than the operator expects, so the number
   * is reported here instead of being discovered on the platform.
   */
  coverage: AudienceExportColumnCoverage[];
  warnings: string[];
}

export function normalizeEmail(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export function normalizeCountry(
  value: string | null | undefined,
): AudienceCountry | "" {
  const normalized = (value ?? "").trim().toUpperCase();
  return (SUPPORTED_AUDIENCE_COUNTRIES as readonly string[]).includes(normalized)
    ? (normalized as AudienceCountry)
    : "";
}

/**
 * Postal code, upper-cased with collapsed internal spacing.
 *
 * The space is kept rather than stripped: some countries write a postal code with
 * an internal space and both platforms accept it. Nothing is invented for a country whose format we
 * cannot validate — an unfamiliar code passes through rather than being lost.
 */
export function normalizeZip(value: string | null | undefined): string {
  return (value ?? "").trim().toUpperCase().replace(/\s+/g, " ");
}

export function normalizeName(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/**
 * Splits one display name into first and last.
 *
 * The store customer model carries a single `name`, so this is lossy for
 * compound surnames. It takes the first token as the given name and the rest as
 * the family name: right for the common case, and it never drops a component.
 */
export function splitDisplayName(value: string | null | undefined): {
  firstName: string;
  lastName: string;
} {
  const parts = (value ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

/**
 * Phone in E.164 (`+6281234567890`).
 *
 * A number already in international form is kept. A national number is lifted
 * with the record's country, dropping the trunk zero that Indonesian and
 * Malaysian numbers carry locally. Without a country a national number cannot be made
 * unambiguous, so it is refused rather than prefixed with a guess: a wrong
 * country code yields a real phone number belonging to someone else.
 */
export function normalizePhoneE164(
  value: string | null | undefined,
  country: AudienceCountry | "" = "",
): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";

  const isInternational = raw.startsWith("+") || raw.startsWith("00");
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";

  if (isInternational) {
    const international = raw.startsWith("00") ? digits.slice(2) : digits;
    return international.length >= 8 && international.length <= 15
      ? `+${international}`
      : "";
  }

  if (!country) return "";

  const national = digits.replace(/^0+/, "");
  if (!national) return "";

  const combined = `${COUNTRY_DIAL_CODES[country]}${national}`;
  return combined.length >= 8 && combined.length <= 15 ? `+${combined}` : "";
}

/** Makes a spreadsheet treat the cell as text rather than a formula. */
const FORMULA_GUARD = String.fromCharCode(39);
/** Always a formula lead-in, whatever follows. */
const FORMULA_LEAD = /^[=@\t\r]/;
/** A signed plain number: inert in a spreadsheet, and the shape of E.164. */
const SIGNED_NUMBER = /^[+-]\d+(\.\d+)?$/;

/**
 * Escapes one CSV cell.
 *
 * Two jobs. RFC 4180 quoting, and neutralising spreadsheet formula injection:
 * a customer-supplied name beginning with `=`, `@`, `+` or `-` runs as a
 * formula when the file is opened in Excel or Sheets, and a leading apostrophe
 * makes it inert.
 *
 * The exception matters as much as the rule: `+447911123456` is a phone number,
 * not a formula, and guarding it would corrupt every E.164 cell in the file and
 * quietly destroy the match rate. A lone signed number is inert anyway, so only
 * a `+`/`-` value that is *not* a plain number is guarded.
 */
export function csvCell(value: string | number): string {
  const raw = String(value ?? "");
  const isFormulaRisk =
    FORMULA_LEAD.test(raw) || (/^[+-]/.test(raw) && !SIGNED_NUMBER.test(raw));
  const neutralised = isFormulaRisk ? `${FORMULA_GUARD}${raw}` : raw;
  return `"${neutralised.replace(/"/g, '""')}"`;
}

function formatValue(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : "0.00";
}

function formatCount(value: number): string {
  return Number.isFinite(value) && value > 0 ? String(Math.trunc(value)) : "0";
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Builds the CSV for one destination.
 *
 * Rows with no matchable identifier are dropped and counted. Identity fields
 * are normalised before hashing, because a hash of an untrimmed, mixed-case
 * address matches nothing on either platform.
 */
export function buildAudienceExportCsv(
  records: readonly AudienceCustomerRecord[],
  options: AudienceExportOptions,
): AudienceExportResult {
  const preset = AUDIENCE_EXPORT_PRESETS[options.preset];
  if (!preset) {
    throw new Error(`Unknown audience export preset: ${options.preset}`);
  }

  const hash = options.hash ?? "none";
  if (hash === "sha256" && preset.hashableColumns.length === 0) {
    throw new Error(
      "The raw cohort export cannot be hashed; hashed identifiers cannot be analysed.",
    );
  }

  const warnings: string[] = [];
  const segmentFilter = options.segments?.length
    ? new Set(options.segments)
    : null;

  let filteredOutRows = 0;
  let droppedUnmatchableRows = 0;
  const populated = new Map<AudienceColumnKey, number>();
  const lines: string[] = [
    preset.columns.map((column) => csvCell(column.header)).join(","),
  ];

  for (const record of records) {
    if (segmentFilter && !segmentFilter.has(record.cohortSegment)) {
      filteredOutRows += 1;
      continue;
    }

    const country = normalizeCountry(record.country);
    const normalised: Record<AudienceColumnKey, string> = {
      email: normalizeEmail(record.email),
      phone: normalizePhoneE164(record.phone, country),
      firstName: normalizeName(record.firstName),
      lastName: normalizeName(record.lastName),
      zip: normalizeZip(record.zip),
      country,
      purchaseValue: formatValue(record.purchaseValue),
      orderCount: formatCount(record.orderCount),
      cohortSegment: record.cohortSegment,
    };

    const hasIdentifier = preset.identifierColumns.some(
      (column) => normalised[column].length > 0,
    );
    if (!hasIdentifier) {
      droppedUnmatchableRows += 1;
      continue;
    }

    const cells = preset.columns.map((column) => {
      const value = normalised[column.key];
      if (value) {
        populated.set(column.key, (populated.get(column.key) ?? 0) + 1);
      }

      const shouldHash =
        hash === "sha256" &&
        value.length > 0 &&
        preset.hashableColumns.includes(column.key);
      return csvCell(shouldHash ? sha256Hex(value) : value);
    });

    lines.push(cells.join(","));
  }

  const rowCount = lines.length - 1;
  const coverage = preset.columns.map<AudienceExportColumnCoverage>((column) => {
    const populatedRows = populated.get(column.key) ?? 0;
    return {
      column: column.key,
      header: column.header,
      populatedRows,
      coveragePercent:
        rowCount === 0 ? 0 : Math.round((populatedRows / rowCount) * 1000) / 10,
    };
  });

  for (const entry of coverage) {
    if (entry.populatedRows === 0 && rowCount > 0) {
      warnings.push(
        `Column ${entry.header} is empty for every row. The upload is still accepted, but this identifier cannot contribute to the match rate.`,
      );
    }
  }

  if (droppedUnmatchableRows > 0) {
    warnings.push(
      `${droppedUnmatchableRows} record(s) carried neither an email nor a usable phone number and were left out.`,
    );
  }

  return {
    csv: lines.join("\r\n"),
    presetId: preset.id,
    currency: options.currency,
    hashed: hash === "sha256",
    rowCount,
    droppedUnmatchableRows,
    filteredOutRows,
    coverage,
    warnings,
  };
}

/**
 * Adapts the store RFM rows onto the export record.
 *
 * The store model carries `firstName` and `lastName` directly; `splitDisplayName`
 * covers the rows where only the combined `name` was populated, so a partially
 * migrated dataset still exports a usable name. `defaults.country` fills a row
 * whose country is blank — the brand's own market is a safer assumption than an
 * empty cell, and it is the caller who knows which brand this list belongs to.
 * Whatever stays empty is reported by the coverage figures rather than hidden.
 */
export function toAudienceRecords(
  customers: readonly CustomerRfmRow[],
  defaults: { country?: AudienceCountry } = {},
): AudienceCustomerRecord[] {
  return customers.map((customer) => {
    const fallbackName = splitDisplayName(customer.name);
    return {
      email: customer.email,
      phone: customer.phone,
      firstName: customer.firstName?.trim() || fallbackName.firstName,
      lastName: customer.lastName?.trim() || fallbackName.lastName,
      zip: customer.zip,
      country: normalizeCountry(customer.country) || defaults.country || null,
      purchaseValue: customer.monetary,
      orderCount: customer.frequency,
      cohortSegment: mapRfmSegment(customer.segmentKey),
    };
  });
}
