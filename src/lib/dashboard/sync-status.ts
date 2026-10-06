import type { SyncJob } from "@/lib/dashboard/types";

/**
 * The freshest successful sync the client knows about. Stored rows carry their
 * own `syncedAt`, and a job that just succeeded is newer than anything the
 * snapshot could have contained, so the later of the two always wins.
 */
export function latestSyncTimestamp(
  ...candidates: (string | null | undefined)[]
): string | null {
  const valid = candidates.filter(
    (value): value is string =>
      typeof value === "string" &&
      value.length > 0 &&
      !Number.isNaN(Date.parse(value)),
  );

  if (valid.length === 0) return null;

  return valid.reduce((latest, value) =>
    Date.parse(value) > Date.parse(latest) ? value : latest,
  );
}

/**
 * A job moves the marker only after rows were published. `partial` is included:
 * it means real rows landed but coverage (commonly today's provisional data)
 * is incomplete. A failed or still-running attempt never moves the marker.
 */
export function syncCompletionTimestamp(job: SyncJob | null): string | null {
  if (
    !job ||
    (job.status !== "succeeded" && job.status !== "partial")
  ) {
    return null;
  }
  return latestSyncTimestamp(job.updatedAt, job.createdAt);
}
