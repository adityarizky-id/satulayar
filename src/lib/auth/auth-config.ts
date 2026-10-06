export type DashboardAuthMode = "preview" | "supabase";

interface AuthEnvironment {
  DASHBOARD_AUTH_MODE?: string;
  NEXT_PUBLIC_SITE_URL?: string;
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_VERCEL_URL?: string;
  VERCEL_PROJECT_PRODUCTION_URL?: string;
  VERCEL_URL?: string;
  NODE_ENV?: string;
  VERCEL_ENV?: string;
}

export interface AuthConfiguration {
  isProduction: boolean;
  mode: DashboardAuthMode;
  publishableKey: string | null;
  ready: boolean;
  safeMessage: string;
  siteUrl: string | null;
  supabaseUrl: string | null;
}

function clean(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function isValidHttpUrl(value: string | null): boolean {
  if (!value) return false;

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function getAuthConfiguration(
  environment: AuthEnvironment = process.env,
): AuthConfiguration {
  const isProduction = environment.VERCEL_ENV
    ? environment.VERCEL_ENV === "production"
    : environment.NODE_ENV === "production";
  const configuredMode = clean(environment.DASHBOARD_AUTH_MODE);
  const supabaseUrl = clean(environment.NEXT_PUBLIC_SUPABASE_URL);
  const publishableKey = clean(
    environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
  const rawSiteUrl = clean(environment.NEXT_PUBLIC_SITE_URL);
  const vercelHost =
    clean(environment.NEXT_PUBLIC_VERCEL_URL) ||
    clean(environment.VERCEL_PROJECT_PRODUCTION_URL) ||
    clean(environment.VERCEL_URL);
  const fallbackVercelUrl = vercelHost
    ? vercelHost.startsWith("http://") || vercelHost.startsWith("https://")
      ? vercelHost
      : `https://${vercelHost}`
    : null;
  const siteUrl = rawSiteUrl || fallbackVercelUrl;

  const mode: DashboardAuthMode =
    configuredMode === "preview" || configuredMode === "bypass"
      ? "preview"
      : configuredMode === "supabase"
        ? "supabase"
        : isValidHttpUrl(supabaseUrl) && publishableKey
          ? "supabase"
          : "preview";

  if (mode === "preview") {
    return {
      isProduction,
      mode,
      publishableKey,
      ready: true,
      safeMessage:
        "Preview mode is active. No credentials are required.",
      siteUrl,
      supabaseUrl,
    };
  }

  if (!isValidHttpUrl(supabaseUrl) || !publishableKey) {
    return {
      isProduction,
      mode,
      publishableKey,
      ready: false,
      safeMessage:
        "Supabase authentication is not configured. Add the deployment environment variables.",
      siteUrl,
      supabaseUrl,
    };
  }

  if (isProduction && !isValidHttpUrl(siteUrl)) {
    return {
      isProduction,
      mode,
      publishableKey,
      ready: false,
      safeMessage:
        "Production site URL is not configured for secure authentication callbacks.",
      siteUrl,
      supabaseUrl,
    };
  }

  return {
    isProduction,
    mode,
    publishableKey,
    ready: true,
    safeMessage: "Supabase authentication is configured.",
    siteUrl: isValidHttpUrl(siteUrl) ? siteUrl : null,
    supabaseUrl,
  };
}

/**
 * Project URL for server-only, service-role work.
 *
 * Deliberately independent of `requireSupabaseConfiguration`. That function
 * answers "can a *browser* session authenticate?", which depends on
 * `DASHBOARD_AUTH_MODE` and the publishable key. A trusted server worker needs
 * neither: it authenticates with `SUPABASE_SERVICE_ROLE_KEY`. Coupling the two
 * meant that on any device running `DASHBOARD_AUTH_MODE=preview` the OAuth
 * callback could complete against Google and then silently fail to store the
 * token, because `createServiceClient()` threw before it ever reached Supabase.
 *
 * This is not a relaxation: the service-role key is still mandatory and is
 * checked by the caller before this URL is resolved.
 */
export function requireSupabaseProjectUrl(
  environment: AuthEnvironment = process.env,
): string {
  const supabaseUrl = clean(environment.NEXT_PUBLIC_SUPABASE_URL);

  if (!isValidHttpUrl(supabaseUrl) || !supabaseUrl) {
    throw new Error("Supabase project URL is not configured.");
  }

  return supabaseUrl;
}

export function requireSupabaseConfiguration(): {
  publishableKey: string;
  supabaseUrl: string;
} {
  const configuration = getAuthConfiguration();

  if (
    configuration.mode !== "supabase" ||
    !configuration.ready ||
    !configuration.supabaseUrl ||
    !configuration.publishableKey
  ) {
    throw new Error("Supabase authentication is not available.");
  }

  return {
    publishableKey: configuration.publishableKey,
    supabaseUrl: configuration.supabaseUrl,
  };
}
