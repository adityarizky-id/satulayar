import { NextRequest } from "next/server";

import { resolveActiveClientSlug } from "@/lib/auth/client-scope";
import { authFailureResponse, privateJson } from "@/lib/auth/http";
import { resolveAuthContext } from "@/lib/auth/session";
import { ACCOUNT_COOKIE } from "@/lib/dashboard/accounts";
import type { SyncJob, SyncJobStatus } from "@/lib/dashboard/types";
import { getDashboardDataConfiguration } from "@/lib/dashboard/validation";
import { readStoredSyncJob } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const MOCK_JOB_PATTERN =
  /^mock-(\d{13})-(\d{4}-\d{2}-\d{2})-(\d{4}-\d{2}-\d{2})-(all|meta|google)-([a-f0-9]{8})$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const scope = resolveActiveClientSlug({
    requested: request.nextUrl.searchParams.get("account"),
    cookie: request.cookies.get(ACCOUNT_COOKIE)?.value,
  });
  if (!scope.ok) {
    return privateJson({ error: scope.message }, { status: 400 });
  }

  const auth = await resolveAuthContext(scope.clientSlug);
  if (!auth.ok) return authFailureResponse(auth);

  const { id } = await context.params;
  const match = id.match(MOCK_JOB_PATTERN);

  if (!match) {
    const configuration = getDashboardDataConfiguration();

    if (
      configuration.storage !== "supabase" ||
      auth.context.mode !== "supabase" ||
      !UUID_PATTERN.test(id)
    ) {
      return privateJson(
        { error: "Sync job not found." },
        { status: 404 },
      );
    }

    try {
      const job = await readStoredSyncJob(
        auth.context.access.clientId,
        id,
      );
      return job
        ? privateJson(job)
        : privateJson(
            { error: "Sync job not found." },
            { status: 404 },
          );
    } catch {
      return privateJson(
        { error: "Stored sync job is unavailable." },
        { status: 503 },
      );
    }
  }

  const createdAtMs = Number(match[1]);
  const requestedRange = { start: match[2], end: match[3] };
  const requestedPlatform = match[4] as "all" | "meta" | "google";
  const elapsed = Date.now() - createdAtMs;
  let status: SyncJobStatus = "queued";
  let safeMessage = "Fixture refresh queued.";

  if (elapsed >= 600 && elapsed < 1_400) {
    status = "syncing";
    safeMessage = "Reading synthetic Meta and Google fixture rows.";
  } else if (elapsed >= 1_400 && elapsed < 2_100) {
    status = "validating";
    safeMessage = "Validating date coverage and metric contracts.";
  } else if (elapsed >= 2_100) {
    status = "succeeded";
    safeMessage = "Fixture refresh complete. No live connector was called.";
  }

  const job: SyncJob = {
    id,
    status,
    requestedRange,
    platforms:
      requestedPlatform === "all"
        ? ["meta", "google"]
        : [requestedPlatform],
    createdAt: new Date(createdAtMs).toISOString(),
    updatedAt: new Date().toISOString(),
    safeMessage,
  };

  return privateJson(job);
}
