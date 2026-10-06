import { PILOT_CLIENT_SLUG } from "@/lib/auth/constants";
import { accountSlugs, isAccountSlug } from "@/lib/dashboard/accounts";

/**
 * Resolves which brand a request is acting on.
 *
 * Every connector route used to assume Kopi Senja Nusantara. With five brands sharing
 * one deployment, the brand becomes caller-supplied input, and caller-supplied
 * input that selects whose credential gets written, revoked, or refreshed is
 * exactly the kind that must be validated against a fixed list rather than
 * trusted. An unknown slug is refused, never coerced to the pilot: coercion
 * would connect one brand's consent to another brand's row.
 *
 * Absent is different from invalid. A request that names no brand keeps the
 * pilot default, so existing callers and bookmarks continue to work.
 */
export type ClientScopeResult =
  | { ok: true; clientSlug: string }
  | { ok: false; message: string };

export function resolveClientScope(value: unknown): ClientScopeResult {
  if (value === undefined || value === null || value === "") {
    return { ok: true, clientSlug: PILOT_CLIENT_SLUG };
  }

  if (!isAccountSlug(value)) {
    return {
      ok: false,
      message: `Unknown client. Expected one of: ${accountSlugs().join(", ")}.`,
    };
  }

  return { ok: true, clientSlug: (value as string).trim() };
}

/**
 * The brand a page or route acts on: an explicit request value first, then the
 * brand selector cookie, then the pilot.
 *
 * The two sources are trusted differently on purpose. An explicit `?account=`
 * or body `client` is a deliberate choice, so an unknown value is refused. The
 * cookie is ambient and may be stale from a renamed brand, so an unknown value
 * there falls back to the pilot — and the session is then checked against
 * whichever brand was chosen, so a fallback can never read another brand's rows.
 */
export function resolveActiveClientSlug(input: {
  requested?: unknown;
  cookie?: string | null;
}): ClientScopeResult {
  const requested = input.requested;
  if (requested !== undefined && requested !== null && requested !== "") {
    return resolveClientScope(requested);
  }

  if (isAccountSlug(input.cookie)) {
    return { ok: true, clientSlug: input.cookie.trim() };
  }

  return { ok: true, clientSlug: PILOT_CLIENT_SLUG };
}
