/**
 * Activity audit trail contracts and client-safe helpers.
 */

export type AuditAction =
  | "audience.export"
  | "sync.manual"
  | "sync.backfill"
  | "sync.scheduled"
  | "connector.connected"
  | "connector.disconnected"
  | "connector.credentials_saved";

export type AuditOutcome = "succeeded" | "failed" | "denied";

export interface AuditEventRecord {
  id: string;
  actorEmail: string | null;
  actorRole: string | null;
  action: AuditAction;
  subject: string | null;
  outcome: AuditOutcome;
  recordCount: number | null;
  detail: Record<string, unknown>;
  createdAt: string;
}

/** Operator-facing sentence for one row. Used by the account page. */
export function describeAuditEvent(event: AuditEventRecord): string {
  const subject = (event.subject ?? "")
    .replace(/google-ads/gi, "Google Ads")
    .replace(/meta-ads/gi, "Meta Ads")
    .replace(/ads-mcp/gi, "Ads MCP");
  const count = event.recordCount === null
    ? ""
    : ` · ${event.recordCount.toLocaleString("en-GB")} ${event.recordCount === 1 ? "record" : "records"}`;

  switch (event.action) {
    case "audience.export":
      return `Exported ${subject || "the selected audience"}${count}.`;
    case "sync.manual":
      return `Refreshed ${subject || "the selected platforms"}${count}.`;
    case "sync.backfill":
      return `Backfilled ${subject || "the selected reporting window"}${count}.`;
    case "sync.scheduled":
      return `Completed the scheduled refresh for ${subject || "the trailing reporting window"}${count}.`;
    case "connector.connected":
      return `Connected ${subject || "a data source"}.`;
    case "connector.disconnected":
      return `Revoked access to ${subject || "a data source"}.`;
    case "connector.credentials_saved":
      return `Saved new API credentials for ${subject || "a data source"}.`;
  }
}

/**
 * Returns deterministic preview audit rows so the account page always has a
 * readable, realistic activity feed during preview mode or before production syncs run.
 */
export function getPreviewAuditEvents(accountSlug = "kopi-senja"): AuditEventRecord[] {
  return [
    {
      id: "preview-audit-1",
      actorEmail: "operator@satulayar.example",
      actorRole: "internal_editor",
      action: "audience.export",
      subject: `Meta Value-Based (${accountSlug})`,
      outcome: "succeeded",
      recordCount: 420,
      detail: {
        mode: "dummy",
        format: "meta-value-based",
        sanitised: true,
        filename: `SYNTHETIC-${accountSlug}-meta-value-based-2026-09-12.csv`,
      },
      createdAt: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
    },
    {
      id: "preview-audit-2",
      actorEmail: "owner@satulayar.example",
      actorRole: "admin",
      action: "sync.manual",
      subject: "google-ads, meta-ads",
      outcome: "succeeded",
      recordCount: 120,
      detail: {
        lookbackDays: 14,
        latencyMs: 540,
        platforms: ["google", "meta"],
      },
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: "preview-audit-3",
      actorEmail: null,
      actorRole: null,
      action: "sync.scheduled",
      subject: "trailing 7-day window",
      outcome: "succeeded",
      recordCount: 60,
      detail: {
        trigger: "vercel-cron",
        timezone: "Asia/Jakarta",
        status: "complete",
      },
      createdAt: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: "preview-audit-4",
      actorEmail: "owner@satulayar.example",
      actorRole: "admin",
      action: "connector.connected",
      subject: "google-ads (ads-mcp)",
      outcome: "succeeded",
      recordCount: null,
      detail: {
        scope: "adwords",
        accountKey: "1234500001",
        status: "active",
      },
      createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
    },
  ];
}
