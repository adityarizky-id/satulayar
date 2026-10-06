/**
 * Creates a sign-in for a team member and grants it read-only access.
 *
 * Accounts are provisioned here, by an admin, and nowhere else: the sign-in
 * routes never create or repair a user. The password is random, printed once
 * to this terminal, and never written to disk or to the database in clear.
 *
 * Usage:
 *   pnpm tsx scripts/admin/create-viewer.ts --email name@example.com
 *   pnpm tsx scripts/admin/create-viewer.ts --email name@example.com --clients kopi-senja,batik-lestari
 *   pnpm tsx scripts/admin/create-viewer.ts --email name@example.com --role internal_editor
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, read from the
 * environment or from .env.local.
 */
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { accountSlugs } from "@/lib/dashboard/accounts";

const GRANTABLE_ROLES = ["viewer", "internal_editor"] as const;
type GrantableRole = (typeof GRANTABLE_ROLES)[number];

function readArgument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function fail(message: string): never {
  console.error(`create-viewer: ${message}`);
  process.exit(1);
}

type AdminClient = SupabaseClient<any, "public", any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function findUserIdByEmail(
  supabase: AdminClient,
  email: string,
): Promise<string | null> {
  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) fail(`could not list users: ${error.message}`);
    const match = data.users.find((user) => user.email?.toLowerCase() === email);
    if (match) return match.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

async function main() {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");

  const email = readArgument("email")?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fail("pass a valid --email");
  }

  const role = (readArgument("role") ?? "viewer") as GrantableRole;
  if (!GRANTABLE_ROLES.includes(role)) {
    fail(`--role must be one of ${GRANTABLE_ROLES.join(", ")}; admins are granted by hand`);
  }

  const requestedClients = readArgument("clients");
  const clientSlugs = requestedClients
    ? requestedClients.split(",").map((slug) => slug.trim()).filter(Boolean)
    : accountSlugs();
  const unknown = clientSlugs.filter((slug) => !accountSlugs().includes(slug));
  if (unknown.length > 0) fail(`unknown client slug(s): ${unknown.join(", ")}`);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceRoleKey) {
    fail("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  }

  const supabase = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });

  let userId = await findUserIdByEmail(supabase, email);
  let password: string | null = null;

  if (userId) {
    console.log(`User ${email} already exists; the password is left unchanged.`);
  } else {
    password = randomBytes(18).toString("base64url");
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error || !data.user) fail(`could not create user: ${error?.message ?? "no user returned"}`);
    userId = data.user.id;
  }

  // The auth trigger normally writes this row; upserting keeps the script
  // correct on a project where the trigger has not run yet.
  const { error: appUserError } = await supabase
    .from("app_users")
    .upsert({ id: userId, email }, { onConflict: "id" });
  if (appUserError) fail(`could not record app user: ${appUserError.message}`);

  const { data: clients, error: clientError } = await supabase
    .from("clients")
    .select("id, slug")
    .in("slug", clientSlugs);
  if (clientError) fail(`could not read clients: ${clientError.message}`);

  const found = new Set((clients ?? []).map((client) => client.slug as string));
  const missing = clientSlugs.filter((slug) => !found.has(slug));
  if (missing.length > 0) {
    fail(`client row(s) missing, run the migrations first: ${missing.join(", ")}`);
  }

  // An existing membership is never overwritten: re-running this for an admin
  // must not quietly demote them to viewer. Role changes are made by hand.
  const { error: membershipError } = await supabase.from("client_memberships").upsert(
    (clients ?? []).map((client) => ({
      user_id: userId,
      client_id: client.id,
      role,
      is_active: true,
    })),
    { onConflict: "user_id,client_id", ignoreDuplicates: true },
  );
  if (membershipError) fail(`could not grant access: ${membershipError.message}`);

  console.log(`Granted ${role} on: ${clientSlugs.join(", ")} (existing memberships kept as they were)`);
  if (password) {
    console.log("");
    console.log(`Email:    ${email}`);
    console.log(`Password: ${password}`);
    console.log("");
    console.log("Shown once. Share it through a private channel and ask the member to keep it private.");
  }
}

void main();
