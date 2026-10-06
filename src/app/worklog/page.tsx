import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { WorklogShell } from "@/components/dashboard/worklog-shell";
import { PILOT_CLIENT_SLUG } from "@/lib/auth/constants";
import { resolveAuthContext } from "@/lib/auth/session";
import {
  ACCOUNT_COOKIE,
  ACCOUNT_OPTIONS,
  resolveAccount,
} from "@/lib/dashboard/accounts";
import { getWorklogDateKey, listWorklog } from "@/lib/dashboard/worklog";
import { BrandGlyph } from "@/components/dashboard/brand-mark";

export const dynamic = "force-dynamic";

export default async function WorklogPage() {
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

  return (
    <WorklogShell
      accounts={ACCOUNT_OPTIONS}
      initialOccurredOn={getWorklogDateKey(new Date(), account.timezone)}
      initialEntries={listWorklog(account.slug)}
      selectedAccount={account.slug}
      viewer={{
        email: auth.context.email,
        mode: auth.context.mode,
        role: auth.context.access.role,
      }}
    />
  );
}
