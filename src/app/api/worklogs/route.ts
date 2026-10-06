import { NextRequest } from "next/server";

import { hasPermission } from "@/lib/auth/authorization";
import { PILOT_CLIENT_SLUG } from "@/lib/auth/constants";
import {
  authFailureResponse,
  isSameOriginRequest,
  privateJson,
} from "@/lib/auth/http";
import { resolveAuthContext } from "@/lib/auth/session";
import { resolveAccount } from "@/lib/dashboard/accounts";
import { getDashboardDataConfiguration } from "@/lib/dashboard/validation";
import {
  approveStoredWorklogEntry,
  persistWorklogEntry,
  readStoredWorklog,
} from "@/lib/supabase/server";
import {
  addWorklogEntry,
  approveWorklogEntry,
  listWorklog,
  validateWorklogDraft,
  type WorklogDraft,
} from "@/lib/dashboard/worklog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await resolveAuthContext(PILOT_CLIENT_SLUG);
  if (!auth.ok) return authFailureResponse(auth);

  const account = resolveAccount(request.nextUrl.searchParams.get("account"));
  const configuration = getDashboardDataConfiguration();

  // Supabase is the store once it is configured; the in-process list is only
  // the preview path and never persists past a restart.
  if (configuration.storage === "supabase" && auth.context.mode === "supabase") {
    try {
      const entries = await readStoredWorklog(
        auth.context.access.clientId,
        account.slug,
      );
      return privateJson({ entries, storage: "supabase" });
    } catch {
      return privateJson(
        { error: "Stored worklog entries are unavailable." },
        { status: 503 },
      );
    }
  }

  return privateJson({ entries: listWorklog(account.slug), storage: "preview" });
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return privateJson(
      { error: "Request origin is not allowed." },
      { status: 403 },
    );
  }

  const auth = await resolveAuthContext(PILOT_CLIENT_SLUG);
  if (!auth.ok) return authFailureResponse(auth);
  if (!hasPermission(auth.context.access.role, "worklog:write")) {
    return privateJson(
      { error: "Your role cannot write a worklog entry." },
      { status: 403 },
    );
  }

  let body: Partial<WorklogDraft> & { approveId?: string };

  try {
    body = (await request.json()) as Partial<WorklogDraft> & {
      approveId?: string;
    };
  } catch {
    return privateJson(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  // Approval is a separate permission: writing an entry does not approve it.
  if (body.approveId) {
    if (!hasPermission(auth.context.access.role, "summary:review")) {
      return privateJson(
        { error: "Your role cannot approve a worklog entry." },
        { status: 403 },
      );
    }

    const configuration = getDashboardDataConfiguration();

    if (
      configuration.storage === "supabase" &&
      auth.context.mode === "supabase"
    ) {
      const done = await approveStoredWorklogEntry(
        auth.context.access.clientId,
        body.approveId,
        auth.context.userId,
      );
      return done
        ? privateJson({ approved: body.approveId })
        : privateJson(
            { error: "Worklog entry not found." },
            { status: 404 },
          );
    }

    const approved = approveWorklogEntry(body.approveId);
    return approved
      ? privateJson({ entry: approved })
      : privateJson({ error: "Worklog entry not found." }, { status: 404 });
  }

  const account = resolveAccount(body.accountSlug);
  const draft: Partial<WorklogDraft> = {
    ...body,
    accountSlug: account.slug,
    status: body.status === "needs-review" ? "needs-review" : "draft",
  };
  const validation = validateWorklogDraft(draft);

  if (!validation.ok) {
    return privateJson(
      { error: "Some fields need attention.", fields: validation.errors },
      { status: 400 },
    );
  }

  const configuration = getDashboardDataConfiguration();

  if (configuration.storage === "supabase" && auth.context.mode === "supabase") {
    try {
      const stored = await persistWorklogEntry(
        auth.context.access.clientId,
        draft as WorklogDraft,
      );
      return privateJson({ entry: stored }, { status: 201 });
    } catch {
      return privateJson(
        { error: "The worklog entry could not be stored." },
        { status: 503 },
      );
    }
  }

  const entry = addWorklogEntry(
    draft as WorklogDraft,
    auth.context.email ?? auth.context.userId,
  );

  return privateJson({ entry }, { status: 201 });
}
