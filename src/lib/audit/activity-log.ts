import { createClient, createServiceClient } from "@/lib/supabase/server";
import type {
  AuditAction,
  AuditEventRecord,
  AuditOutcome,
} from "./types";

export * from "./types";

/**
 * Activity audit trail.
 *
 * Writes go through the service role, because a browser session must not be
 * able to write its own trail; reads go through the caller's session, so RLS
 * keeps a member inside their own client. Nothing here records what was
 * exported, only that an export happened, by whom, and how large it was.
 */

export interface AuditEventInput {
  clientId: string;
  /** Null for an unattended run; a machine action is not pinned on a person. */
  actorUserId?: string | null;
  actorEmail?: string | null;
  actorRole?: "admin" | "internal_editor" | "viewer" | null;
  action: AuditAction;
  /** Connector platform, export preset, or requested range. Never PII. */
  subject?: string | null;
  outcome?: AuditOutcome;
  /** Rows exported or written, or days requested. A count, never contents. */
  recordCount?: number | null;
  detail?: Record<string, unknown>;
}

interface StoredAuditRow {
  id: string;
  actor_email: string | null;
  actor_role: string | null;
  action: AuditAction;
  subject: string | null;
  outcome: AuditOutcome;
  record_count: number | null;
  detail: Record<string, unknown> | null;
  created_at: string;
}

const AUDIT_COLUMNS =
  "id, actor_email, actor_role, action, subject, outcome, record_count, detail, created_at";

/**
 * Fields that must never reach the trail even if a caller passes them.
 *
 * The guard is deliberately blunt: an audit row is read by people who are
 * investigating an incident, and a log that itself leaked a credential or a
 * customer row would turn one incident into two.
 */
const FORBIDDEN_DETAIL_KEYS = [
  "email",
  "phone",
  "zip",
  "postcode",
  "name",
  "firstname",
  "lastname",
  "token",
  "access_token",
  "refresh_token",
  "secret",
  "password",
  "csv",
  "rows",
  "customers",
];

export function sanitiseAuditDetail(
  detail: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!detail) return {};

  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(detail)) {
    const normalised = key.toLowerCase().replace(/[^a-z_]/g, "");
    if (FORBIDDEN_DETAIL_KEYS.some((forbidden) => normalised.includes(forbidden))) {
      safe[key] = "[redacted]";
      continue;
    }
    // Only primitives and short strings survive. An object could carry anything.
    if (value === null || typeof value === "number" || typeof value === "boolean") {
      safe[key] = value;
    } else if (typeof value === "string") {
      safe[key] = value.slice(0, 200);
    } else if (Array.isArray(value)) {
      safe[key] = value
        .filter((item) => typeof item === "string" || typeof item === "number")
        .slice(0, 20);
    } else {
      safe[key] = "[omitted]";
    }
  }

  return safe;
}

/**
 * Appends one row.
 *
 * Returns whether the write landed rather than throwing, so a caller can decide
 * for itself. A PII export should treat `false` as fatal and refuse to hand the
 * file over; a sync should still complete and report the gap, because losing a
 * refresh over a missing log entry helps nobody.
 */
export async function recordAuditEvent(
  input: AuditEventInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("activity_audit_log")
      .insert({
        client_id: input.clientId,
        actor_user_id: input.actorUserId ?? null,
        actor_email: input.actorEmail ?? null,
        actor_role: input.actorRole ?? null,
        action: input.action,
        subject: input.subject ?? null,
        outcome: input.outcome ?? "succeeded",
        record_count: input.recordCount ?? null,
        detail: sanitiseAuditDetail(input.detail),
      })
      .select("id")
      .single();

    if (error || !data) {
      return { ok: false, error: "The activity could not be recorded." };
    }

    return { ok: true, id: (data as { id: string }).id };
  } catch {
    // The message stays generic: a storage error here must not describe the
    // deployment's configuration to whoever triggered the action.
    return { ok: false, error: "The activity could not be recorded." };
  }
}

/**
 * Reads the trail for the account page, under the caller's own session so RLS
 * decides what they may see.
 */
export async function readAuditTrail(
  clientId: string,
  limit = 50,
): Promise<AuditEventRecord[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("activity_audit_log")
    .select(AUDIT_COLUMNS)
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 200));

  if (error) throw new Error("The activity trail is unavailable.");

  return ((data ?? []) as StoredAuditRow[]).map((row) => ({
    id: row.id,
    actorEmail: row.actor_email,
    actorRole: row.actor_role,
    action: row.action,
    subject: row.subject,
    outcome: row.outcome,
    recordCount: row.record_count,
    detail: row.detail ?? {},
    createdAt: row.created_at,
  }));
}
