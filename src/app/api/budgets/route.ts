import { NextRequest } from "next/server";

import { hasPermission } from "@/lib/auth/authorization";
import { resolveClientScope } from "@/lib/auth/client-scope";
import {
  authFailureResponse,
  isSameOriginRequest,
  privateJson,
} from "@/lib/auth/http";
import { resolveAuthContext } from "@/lib/auth/session";
import { resolveAccount } from "@/lib/dashboard/accounts";
import { normaliseBudgets } from "@/lib/dashboard/budget";
import {
  currentDateInTimeZone,
  resolvePacingCycle,
  resolveReportingCycle,
} from "@/lib/dashboard/timeframes";
import { getDashboardDataConfiguration } from "@/lib/dashboard/validation";
import {
  resolveBudgetsForClient,
  upsertClientBudget,
} from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The agreed monthly plan for one brand, for one 30-day reporting cycle.
 *
 * The brand is always explicit and always validated against the fixed list.
 * The previous design kept a single cookie for every brand at once, so the
 * plan the team agreed for Kopi Senja Nusantara paced Kriya Bali's spend.
 * Here an unknown slug is refused rather than coerced to the pilot, and the
 * session is then checked against the brand actually named — a request can
 * never read or write a brand its caller is not a member of.
 */
function resolveCycleStart(
  requested: string | null | undefined,
  timezone: string,
): { ok: true; cycleStart: string } | { ok: false; message: string } {
  // The caller sends the last day of the window it is looking at, not a cycle
  // start, because that is what the reader actually selected. The cycle is
  // derived here so a caller cannot write to a date that is not a real cycle
  // boundary and quietly create a row no reader will ever resolve to.
  const today = currentDateInTimeZone(timezone);

  if (requested !== undefined && requested !== null && requested !== "") {
    if (!ISO_DATE.test(requested) || Number.isNaN(Date.parse(`${requested}T00:00:00Z`))) {
      return { ok: false, message: "Window end must be a YYYY-MM-DD date." };
    }

    // Clamped to today by the same rule the pacing card uses, so the cycle
    // whose budget is edited here is always the cycle being paced on screen. A
    // filter reaching into the future would otherwise load and overwrite the
    // budget of a cycle that has not started.
    return {
      ok: true,
      cycleStart: resolvePacingCycle(
        { start: requested, end: requested },
        today,
      ).start,
    };
  }

  return { ok: true, cycleStart: resolveReportingCycle(today).start };
}

export async function GET(request: NextRequest) {
  const scope = resolveClientScope(request.nextUrl.searchParams.get("account"));
  if (!scope.ok) return privateJson({ error: scope.message }, { status: 400 });

  const auth = await resolveAuthContext(scope.clientSlug);
  if (!auth.ok) return authFailureResponse(auth);

  const account = resolveAccount(scope.clientSlug);
  const cycle = resolveCycleStart(
    request.nextUrl.searchParams.get("windowEnd"),
    account.timezone,
  );
  if (!cycle.ok) return privateJson({ error: cycle.message }, { status: 400 });

  const configuration = getDashboardDataConfiguration();

  try {
    const resolved = await resolveBudgetsForClient({
      clientId: auth.context.access.clientId,
      cycleStart: cycle.cycleStart,
      currency: account.currency,
      useStore:
        configuration.storage === "supabase" &&
        auth.context.mode === "supabase",
    });

    return privateJson({
      account: scope.clientSlug,
      currency: account.currency,
      /** The cycle the reader is looking at. */
      cycleStart: cycle.cycleStart,
      budgets: resolved.budgets,
      source: resolved.source,
      /** The cycle the figures were agreed against; earlier when carried. */
      planCycleStart: resolved.cycleStart,
    });
  } catch {
    return privateJson(
      { error: "The agreed budget is unavailable." },
      { status: 503 },
    );
  }
}

export async function PUT(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return privateJson(
      { error: "Request origin is not allowed." },
      { status: 403 },
    );
  }

  let body: { account?: unknown; meta?: unknown; google?: unknown; windowEnd?: unknown };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return privateJson(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const scope = resolveClientScope(body.account);
  if (!scope.ok) return privateJson({ error: scope.message }, { status: 400 });

  const auth = await resolveAuthContext(scope.clientSlug);
  if (!auth.ok) return authFailureResponse(auth);
  if (!hasPermission(auth.context.access.role, "budget:write")) {
    return privateJson(
      { error: "Your role cannot change the agreed budget." },
      { status: 403 },
    );
  }

  const account = resolveAccount(scope.clientSlug);
  const cycle = resolveCycleStart(
    typeof body.windowEnd === "string" ? body.windowEnd : null,
    account.timezone,
  );
  if (!cycle.ok) return privateJson({ error: cycle.message }, { status: 400 });

  const budgets = normaliseBudgets({ meta: body.meta, google: body.google });
  const configuration = getDashboardDataConfiguration();

  // Preview and demo paths have no stored agreement to write to. The caller
  // keeps its per-brand cookie; this route does not pretend it persisted.
  if (
    configuration.storage !== "supabase" ||
    auth.context.mode !== "supabase"
  ) {
    return privateJson({
      account: scope.clientSlug,
      currency: account.currency,
      cycleStart: cycle.cycleStart,
      budgets,
      source: "local",
      storage: "preview",
    });
  }

  try {
    const stored = await upsertClientBudget(
      auth.context.access.clientId,
      cycle.cycleStart,
      budgets,
      account.currency,
      auth.context.userId,
    );

    return privateJson({
      account: scope.clientSlug,
      currency: stored.currency,
      cycleStart: stored.cycleStart,
      budgets: stored.budgets,
      source: "agreed",
      storage: "supabase",
    });
  } catch {
    return privateJson(
      { error: "The agreed budget could not be saved." },
      { status: 503 },
    );
  }
}
