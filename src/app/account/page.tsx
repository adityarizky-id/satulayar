import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { AccountShell } from "@/components/dashboard/account-shell";
import {
  getPreviewAuditEvents,
  readAuditTrail,
  type AuditEventRecord,
} from "@/lib/audit/activity-log";
import { PILOT_CLIENT_SLUG } from "@/lib/auth/constants";
import { resolveAuthContext } from "@/lib/auth/session";
import {
  ACCOUNT_COOKIE,
  ACCOUNT_OPTIONS,
  resolveAccount,
} from "@/lib/dashboard/accounts";
import { BrandGlyph } from "@/components/dashboard/brand-mark";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const auth = await resolveAuthContext(PILOT_CLIENT_SLUG);

  if (!auth.ok) {
    if (auth.code === "client_access_denied") {
      return (
        <main className="route-state">
          <span className="route-state__mark route-state__mark--error"><BrandGlyph className="route-state__glyph" /></span>
          <h1>Client access is not assigned.</h1>
          <p>{auth.safeMessage}</p>
        </main>
      );
    }

    redirect("/sign-in");
  }

  const cookieStore = await cookies();
  const account = resolveAccount(cookieStore.get(ACCOUNT_COOKIE)?.value);

  // Only the local preview shows sample events. A signed-in session shows the
  // recorded trail, and an empty or unreadable trail stays empty: examples
  // standing in for it would read as real exports and connector changes.
  let auditEvents: AuditEventRecord[] = [];
  if (auth.context.mode === "supabase") {
    try {
      auditEvents = await readAuditTrail(auth.context.access.clientId, 50);
    } catch {
      auditEvents = [];
    }
  } else {
    auditEvents = getPreviewAuditEvents(account.slug);
  }

  return (
    <AccountShell
      accounts={ACCOUNT_OPTIONS}
      auditEvents={auditEvents}
      authMode={auth.context.mode}
      selectedAccount={account.slug}
      viewer={{
        email: auth.context.email,
        mode: auth.context.mode,
        role: auth.context.access.role,
      }}
    />
  );
}
