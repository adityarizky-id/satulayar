export const PILOT_CLIENT_SLUG = "kopi-senja";

/**
 * Optional sign-in allowlist, read from `AUTH_ALLOWED_EMAILS` (comma-separated).
 * When unset, any existing Supabase user may attempt to sign in; access to a
 * workspace is still decided by `client_memberships`, never by this list.
 * Accounts are created by an admin — sign-in never creates or repairs users.
 */
function readAllowedLoginEmails(): Set<string> {
  return new Set(
    (process.env.AUTH_ALLOWED_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isAllowedLoginEmail(email: string): boolean {
  const allowed = readAllowedLoginEmails();
  return allowed.size === 0 || allowed.has(email.trim().toLowerCase());
}
