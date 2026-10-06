 import {
  AUDIENCE_EXPORT_PRESETS,
  type AudienceCohortSegment,
  type AudienceExportPresetId,
} from "@/lib/dashboard/audience-exporter";

/**
 * Validation for the audience-export request, kept out of the route so it can
 * be tested without a server. Everything the caller sends is untrusted: the
 * preset chooses a file layout, the segments filter which customers leave the
 * building, and the acknowledgement decides whether a synthetic file may be
 * produced at all. Each is checked against a fixed list rather than passed
 * through.
 */

export const AUDIENCE_COHORT_SEGMENTS: AudienceCohortSegment[] = [
  "Champions",
  "Loyal Customers",
  "At Risk",
  "Churned",
];

export interface AudienceExportRequest {
  preset: AudienceExportPresetId;
  segments: AudienceCohortSegment[];
  hash: "none" | "sha256";
  /** Brand scope to export. Defaults to the pilot when absent. */
  accountSlug: string | null;
  /**
   * The caller has seen that the store source is still synthetic and wants the
   * file anyway, for a dry run. Without it a dummy-mode export is refused.
   */
  acknowledgeSyntheticData: boolean;
  /** Return the summary as JSON instead of the file. */
  preview: boolean;
}

export type AudienceExportRequestResult =
  | { ok: true; value: AudienceExportRequest }
  | { ok: false; message: string };

function isPresetId(value: unknown): value is AudienceExportPresetId {
  return typeof value === "string" && value in AUDIENCE_EXPORT_PRESETS;
}

export function parseAudienceExportRequest(
  body: unknown,
): AudienceExportRequestResult {
  if (typeof body !== "object" || body === null) {
    return { ok: false, message: "Request body must be a JSON object." };
  }

  const input = body as Record<string, unknown>;

  if (!isPresetId(input.preset)) {
    return {
      ok: false,
      message: `Unknown export preset. Choose one of: ${Object.keys(AUDIENCE_EXPORT_PRESETS).join(", ")}.`,
    };
  }

  const preset = input.preset;

  let segments: AudienceCohortSegment[] = [];
  if (input.segments !== undefined) {
    if (!Array.isArray(input.segments)) {
      return { ok: false, message: "Segments must be an array of cohort names." };
    }
    for (const segment of input.segments) {
      if (!AUDIENCE_COHORT_SEGMENTS.includes(segment as AudienceCohortSegment)) {
        return { ok: false, message: "Segments must be known cohort names." };
      }
    }
    segments = input.segments as AudienceCohortSegment[];
  }

  const hashInput = input.hash ?? "none";
  if (hashInput !== "none" && hashInput !== "sha256") {
    return { ok: false, message: "Hash must be either none or sha256." };
  }
  if (
    hashInput === "sha256" &&
    AUDIENCE_EXPORT_PRESETS[preset].hashableColumns.length === 0
  ) {
    return {
      ok: false,
      message:
        "The raw cohort export cannot be hashed; hashed identifiers cannot be analysed.",
    };
  }

  const accountSlug =
    typeof input.account === "string" && input.account.trim()
      ? input.account.trim()
      : null;

  return {
    ok: true,
    value: {
      preset,
      segments,
      hash: hashInput,
      accountSlug,
      acknowledgeSyntheticData: input.acknowledgeSyntheticData === true,
      preview: input.preview === true,
    },
  };
}

/**
 * Download filename.
 *
 * A synthetic file is named so it cannot be mistaken for a real customer list
 * once it is sitting in a downloads folder, away from the UI that explained it.
 */
export function audienceExportFilename(
  request: Pick<AudienceExportRequest, "preset">,
  accountSlug: string,
  isoDate: string,
  dataMode: "live" | "dummy",
): string {
  const prefix = dataMode === "dummy" ? "SYNTHETIC-" : "";
  return `${prefix}${accountSlug}-${request.preset}-${isoDate}.csv`;
}
