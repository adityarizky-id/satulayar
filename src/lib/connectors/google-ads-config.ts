import { PILOT_CLIENT_SLUG } from "@/lib/auth/constants";
import type { GoogleAdsApiConfiguration } from "@/lib/connectors/google-ads-api-client";
import { ACCOUNT_OPTIONS, isAccountSlug, resolveAccount } from "@/lib/dashboard/accounts";

/**
 * Per-brand Google Ads configuration.
 *
 * The customer id decides whose data a pull returns, so it is resolved per
 * brand and never shared:
 *
 *   1. `connector_tokens.customer_id` for the brand (server-side only).
 *   2. `GOOGLE_ADS_CUSTOMER_ID_<SLUG>` from the deployment environment.
 *   3. The unsuffixed `GOOGLE_ADS_CUSTOMER_ID` — for the pilot brand alone.
 *
 * Before this module the pipeline built one connector from the unsuffixed
 * variables for every brand, so the scheduled job would have pulled the pilot
 * account and stored it under whichever brand it was iterating. Two guards now
 * fail that closed: a non-pilot brand never inherits the unsuffixed id, and
 * two brands resolving to the same customer id refuse to sync at all.
 *
 * Application-level credentials (developer token, OAuth client) come from the
 * brand's own `connector_tokens` row when an operator saved them through the
 * Data sources form, and from the deployment environment otherwise. See
 * `StoredGoogleAdsCredentials` for why they are taken as one set.
 */

export const GOOGLE_ADS_TOKEN_PLATFORM = "google-ads";

/** `metadata.configuredVia` on a row written by the Data sources form. */
export const GOOGLE_ADS_DIRECT_INPUT_SOURCE = "direct_modal_input";

type Environment = Record<string, string | undefined>;

export type GoogleCustomerIdSource =
  | "connector-token"
  | "brand-env"
  | "historical-dataset"
  | "pilot-global-env";

/**
 * Where a resolved configuration took its developer token, OAuth client, and
 * refresh token from. Never a value — only which store answered.
 */
export type GoogleAdsCredentialSource =
  | "connector-token"
  | "manager-connector-token"
  | "environment";

/**
 * A complete credential set an operator saved for one brand.
 *
 * The four secrets are one unit, never four independent fallbacks. A refresh
 * token is bound to the OAuth client that minted it, so pairing a stored
 * refresh token with the deployment's client id — or the reverse — produces an
 * `unauthorized_client` failure that reads exactly like a revoked credential.
 * A row missing any one of them is therefore not a stored set at all, and the
 * brand falls back to the environment as a whole.
 */
export interface StoredGoogleAdsCredentials {
  developerToken: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** Manager (MCC) header; null means the grant reads the account directly. */
  loginCustomerId: string | null;
}

/** Only the columns the parser reads; any stored token record satisfies it. */
export interface StoredCredentialRecordLike {
  refreshToken: string | null;
  mccId?: string | null;
  metadata?: Record<string, unknown> | null;
}

function storedSecret(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Reads the credential set out of a stored row, or null when the row carries
 * no complete set (an OAuth-callback row carries only a refresh token).
 */
export function readStoredGoogleAdsCredentials(
  record: StoredCredentialRecordLike | null | undefined,
): StoredGoogleAdsCredentials | null {
  if (!record) return null;
  const metadata = record.metadata ?? {};
  const developerToken = storedSecret(metadata.developerToken);
  const clientId = storedSecret(metadata.clientId);
  const clientSecret = storedSecret(metadata.clientSecret);
  const refreshToken = storedSecret(record.refreshToken);

  if (!developerToken || !clientId || !clientSecret || !refreshToken) return null;

  return {
    developerToken,
    clientId,
    clientSecret,
    refreshToken,
    loginCustomerId:
      normalizeGoogleCustomerId(
        typeof metadata.loginCustomerId === "string" ? metadata.loginCustomerId : null,
      ) ?? normalizeGoogleCustomerId(record.mccId),
  };
}

export type GoogleAdsCredentialField =
  | "customerId"
  | "developerToken"
  | "clientId"
  | "clientSecret"
  | "refreshToken"
  | "loginCustomerId";

export interface ValidatedGoogleAdsCredentialInput {
  customerId: string;
  developerToken: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  loginCustomerId: string | null;
}

export type GoogleAdsCredentialValidation =
  | { ok: true; value: ValidatedGoogleAdsCredentialInput }
  | { ok: false; field: GoogleAdsCredentialField; safeMessage: string };

/** Longer than any Google credential; a bound, not a format rule. */
const MAX_CREDENTIAL_LENGTH = 2048;

const SECRET_LABELS: Record<
  "developerToken" | "clientId" | "clientSecret" | "refreshToken",
  string
> = {
  developerToken: "Developer token",
  clientId: "Client ID",
  clientSecret: "Client secret",
  refreshToken: "Refresh token",
};

/**
 * Validates what the Data sources form submitted.
 *
 * Messages name the field and the rule, never the value: they are shown in the
 * browser and a message that quoted a pasted secret back would put it on screen
 * and into any error reporting the page does.
 */
export function validateGoogleAdsCredentialInput(
  body: Record<string, unknown>,
): GoogleAdsCredentialValidation {
  const customerId = normalizeGoogleCustomerId(
    typeof body.customerId === "string" ? body.customerId : null,
  );
  if (!customerId) {
    return {
      ok: false,
      field: "customerId",
      safeMessage:
        "Google Ads Customer ID must be a 10-digit account ID, for example 123-450-0001.",
    };
  }

  const secrets = {} as Record<keyof typeof SECRET_LABELS, string>;
  for (const field of Object.keys(SECRET_LABELS) as (keyof typeof SECRET_LABELS)[]) {
    const raw = body[field];
    const value = typeof raw === "string" ? raw.trim() : "";
    const label = SECRET_LABELS[field];
    if (!value) {
      return { ok: false, field, safeMessage: `${label} is required.` };
    }
    if (value.length > MAX_CREDENTIAL_LENGTH) {
      return { ok: false, field, safeMessage: `${label} is longer than any valid Google credential.` };
    }
    // Google issues none of these with whitespace inside; one usually means two
    // values were pasted together or a line break came along with the copy.
    if (/\s/.test(value)) {
      return { ok: false, field, safeMessage: `${label} must not contain spaces or line breaks.` };
    }
    secrets[field] = value;
  }

  if (!secrets.clientId.endsWith(".apps.googleusercontent.com")) {
    return {
      ok: false,
      field: "clientId",
      safeMessage: "Client ID must be an OAuth client ID ending in .apps.googleusercontent.com.",
    };
  }

  const rawLogin = typeof body.loginCustomerId === "string" ? body.loginCustomerId.trim() : "";
  const loginCustomerId = rawLogin ? normalizeGoogleCustomerId(rawLogin) : null;
  if (rawLogin && !loginCustomerId) {
    return {
      ok: false,
      field: "loginCustomerId",
      safeMessage:
        "Manager / MCC Customer ID must be a 10-digit account ID, or left empty.",
    };
  }

  return {
    ok: true,
    value: { customerId, ...secrets, loginCustomerId },
  };
}

/**
 * Removes every submitted secret from a message before it leaves the server.
 *
 * Provider error text is not ours: a future API change, or a proxy in between,
 * could echo part of a request back. Scrubbing against the exact values the
 * operator sent makes the response safe whatever the provider says.
 */
export function redactSubmittedSecrets(
  message: string,
  secrets: readonly (string | null | undefined)[],
): string {
  let safe = message;
  for (const secret of secrets) {
    // A fragment this short is not a credential and would shred ordinary text.
    if (!secret || secret.length < 6) continue;
    safe = safe.split(secret).join("[redacted]");
  }
  return safe;
}

export type GoogleAdsConfigFailureState =
  | "not-configured"
  | "invalid"
  | "collision"
  | "registry-unavailable";

export type GoogleAdsConfigResolution =
  | {
      ok: true;
      clientSlug: string;
      customerIdSource: GoogleCustomerIdSource;
      credentialSource: GoogleAdsCredentialSource;
      config: GoogleAdsApiConfiguration;
    }
  | {
      ok: false;
      clientSlug: string;
      state: GoogleAdsConfigFailureState;
      /** Variable names only — never values. */
      missing: string[];
      safeMessage: string;
    };

export type GoogleCustomerIdResolution =
  | { ok: true; customerId: string; source: GoogleCustomerIdSource }
  | {
      ok: false;
      state: "not-configured" | "invalid";
      missing: string[];
      safeMessage: string;
    };

export interface StoredCustomerId {
  clientSlug: string;
  customerId: string | null;
}

export function googleAdsEnvKey(base: string, clientSlug: string): string {
  return `${base}_${clientSlug.trim().toUpperCase().replace(/-/g, "_")}`;
}

function read(environment: Environment, ...keys: (string | null)[]): string | undefined {
  for (const key of keys) {
    if (!key) continue;
    const value = environment[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

/** Accepts 123-450-0001 or 1234500001; anything else is not a customer id. */
export function normalizeGoogleCustomerId(value: string | null | undefined): string | null {
  const digits = (value ?? "").replace(/[\s-]/g, "");
  return /^\d{10}$/.test(digits) ? digits : null;
}

/**
 * Resolves one brand's customer id without looking at any other brand.
 * Collision checking needs every brand and lives in `resolveGoogleAdsConfig`.
 */
export function resolveGoogleAdsCustomerId(
  clientSlug: string,
  storedCustomerId: string | null | undefined,
  environment: Environment = process.env,
  historicalCustomerId?: string | null,
): GoogleCustomerIdResolution {
  const slug = clientSlug.trim();
  const isPilot = slug === PILOT_CLIENT_SLUG;
  const brandKey = googleAdsEnvKey("GOOGLE_ADS_CUSTOMER_ID", slug);
  const pilotGlobal = normalizeGoogleCustomerId(environment.GOOGLE_ADS_CUSTOMER_ID);

  // A non-pilot brand holding exactly the unsuffixed id inherited it — the OAuth
  // callback used to write that variable into every brand's token row. It is
  // refused for this brand only, so the pilot keeps syncing.
  const inheritedFromPilot = (customerId: string) =>
    !isPilot && pilotGlobal !== null && customerId === pilotGlobal;

  const candidates: { raw: string | undefined; source: GoogleCustomerIdSource; label: string }[] = [
    { raw: storedCustomerId?.trim() || undefined, source: "connector-token", label: "The customer id stored for this brand" },
    { raw: read(environment, brandKey), source: "brand-env", label: brandKey },
    {
      raw: historicalCustomerId?.trim() || undefined,
      source: "historical-dataset",
      label: "The customer id verified by this brand's latest stored live rows",
    },
  ];

  for (const candidate of candidates) {
    if (!candidate.raw) continue;
    const customerId = normalizeGoogleCustomerId(candidate.raw);
    if (!customerId) {
      return {
        ok: false,
        state: "invalid",
        missing: [],
        safeMessage: `${candidate.label} is not a 10-digit Google Ads customer id.`,
      };
    }
    if (inheritedFromPilot(customerId)) {
      return {
        ok: false,
        state: "invalid",
        missing: [],
        safeMessage: `${candidate.label} equals the unsuffixed GOOGLE_ADS_CUSTOMER_ID, which belongs to the pilot brand. It was inherited, not configured, so this brand is refused. Set ${brandKey} to this brand's own account and reconnect Google Ads.`,
      };
    }
    return { ok: true, customerId, source: candidate.source };
  }

  if (isPilot && pilotGlobal) {
    return { ok: true, customerId: pilotGlobal, source: "pilot-global-env" };
  }

  return {
    ok: false,
    state: "not-configured",
    missing: [brandKey],
    safeMessage: `No Google Ads customer id is configured for this brand. Set ${brandKey} or reconnect Google Ads for this brand; the unsuffixed GOOGLE_ADS_CUSTOMER_ID is only ever used for the pilot brand.`,
  };
}

/** Customer ids claimed by more than one brand, keyed by customer id. */
export function detectCustomerIdCollisions(
  resolved: readonly { clientSlug: string; customerId: string }[],
): Map<string, string[]> {
  const byCustomer = new Map<string, Set<string>>();
  for (const item of resolved) {
    const slugs = byCustomer.get(item.customerId) ?? new Set<string>();
    slugs.add(item.clientSlug);
    byCustomer.set(item.customerId, slugs);
  }
  return new Map(
    [...byCustomer.entries()]
      .filter(([, slugs]) => slugs.size > 1)
      .map(([customerId, slugs]) => [customerId, [...slugs].toSorted()]),
  );
}

export function resolveGoogleAdsConfig(
  clientSlug: string,
  options: {
    storedCustomerIds: readonly StoredCustomerId[];
    historicalCustomerIds?: readonly StoredCustomerId[];
    environment?: Environment;
    /**
     * Credential sets read from `connector_tokens`. `own` is this brand's row;
     * `manager` is a set held on the manager account, which the loader only
     * supplies when this brand has no refresh token of its own anywhere.
     */
    storedCredentials?: {
      own?: StoredGoogleAdsCredentials | null;
      manager?: StoredGoogleAdsCredentials | null;
    };
  },
): GoogleAdsConfigResolution {
  const environment = options.environment ?? process.env;
  const slug = clientSlug.trim();

  if (!isAccountSlug(slug)) {
    return {
      ok: false,
      clientSlug: slug,
      state: "invalid",
      missing: [],
      safeMessage: "Google Ads is not available for an unknown brand.",
    };
  }

  const account = resolveAccount(slug);
  if (!account.platforms.includes("google")) {
    return {
      ok: false,
      clientSlug: slug,
      state: "invalid",
      missing: [],
      safeMessage: `${account.name} does not run Google Ads, so there is nothing to pull.`,
    };
  }

  const storedFor = (target: string) =>
    options.storedCustomerIds.find((row) => row.clientSlug === target)?.customerId ?? null;
  const historicalFor = (target: string) =>
    options.historicalCustomerIds?.find((row) => row.clientSlug === target)
      ?.customerId ?? null;

  const own = resolveGoogleAdsCustomerId(
    slug,
    storedFor(slug),
    environment,
    historicalFor(slug),
  );
  if (!own.ok) {
    return { clientSlug: slug, ...own };
  }

  // Every other brand that could claim an account: the Google brands in the
  // allowlist plus any slug that holds a stored credential.
  const otherSlugs = new Set<string>([
    ...ACCOUNT_OPTIONS.filter((option) => option.platforms.includes("google")).map(
      (option) => option.slug,
    ),
    ...options.storedCustomerIds.map((row) => row.clientSlug),
  ]);
  otherSlugs.delete(slug);

  const claims: { clientSlug: string; customerId: string }[] = [
    { clientSlug: slug, customerId: own.customerId },
  ];
  for (const other of otherSlugs) {
    const resolution = resolveGoogleAdsCustomerId(
      other,
      storedFor(other),
      environment,
      historicalFor(other),
    );
    // A brand that cannot resolve will never sync, so it cannot collide.
    if (resolution.ok) claims.push({ clientSlug: other, customerId: resolution.customerId });
  }

  const collision = detectCustomerIdCollisions(claims).get(own.customerId);
  if (collision) {
    return {
      ok: false,
      clientSlug: slug,
      state: "collision",
      missing: [],
      safeMessage: `The Google Ads customer id for this brand is also mapped to ${collision
        .filter((item) => item !== slug)
        .join(", ")}. Two brands cannot read the same account, so sync is refused for every brand involved until the mapping is corrected.`,
    };
  }

  const isPilot = slug === PILOT_CLIENT_SLUG;
  const brandOrPilot = (base: string) =>
    read(environment, googleAdsEnvKey(base, slug), isPilot ? base : null);

  // The brand's own saved set outranks the environment; a set held on the
  // manager is next. Either is taken whole — see `StoredGoogleAdsCredentials`.
  const ownSet = options.storedCredentials?.own ?? null;
  const managerSet = ownSet ? null : (options.storedCredentials?.manager ?? null);
  const storedSet = ownSet ?? managerSet;
  const credentialSource: GoogleAdsCredentialSource = ownSet
    ? "connector-token"
    : managerSet
      ? "manager-connector-token"
      : "environment";

  return {
    ok: true,
    clientSlug: slug,
    customerIdSource: own.source,
    credentialSource,
    config: {
      developerToken:
        storedSet?.developerToken ?? read(environment, "GOOGLE_ADS_DEVELOPER_TOKEN"),
      clientId: storedSet?.clientId ?? read(environment, "GOOGLE_ADS_CLIENT_ID"),
      clientSecret:
        storedSet?.clientSecret ?? read(environment, "GOOGLE_ADS_CLIENT_SECRET"),
      // Unsuffixed refresh token is a device-local fallback for the pilot only;
      // every other brand reads its own `connector_tokens` row by slug.
      refreshToken: storedSet?.refreshToken ?? brandOrPilot("GOOGLE_ADS_REFRESH_TOKEN"),
      customerId: own.customerId,
      // The manager (MCC) header authorises access; it does not pick the data,
      // so a shared manager id is safe to fall back to. A saved set states its
      // own manager, including "none": the environment's manager header on a
      // grant that cannot see that manager would fail every query.
      loginCustomerId: storedSet
        ? (storedSet.loginCustomerId ?? undefined)
        : read(
            environment,
            googleAdsEnvKey("GOOGLE_ADS_LOGIN_CUSTOMER_ID", slug),
            "GOOGLE_ADS_LOGIN_CUSTOMER_ID",
          ),
      apiVersion: read(environment, "GOOGLE_ADS_API_VERSION"),
      // Conversion action ids belong to one account. A brand that inherited the
      // pilot's ids would fail verification at best and misreport at worst.
      registrationConversionActionId: brandOrPilot("GOOGLE_ADS_REGISTRATION_CONVERSION_ACTION_ID"),
      purchaseConversionActionId: brandOrPilot("GOOGLE_ADS_PURCHASE_CONVERSION_ACTION_ID"),
      expectedCurrency: account.currency,
      clientSlug: slug,
      includeCampaignBreakdown: environment.GOOGLE_ADS_INCLUDE_CAMPAIGN_BREAKDOWN !== "false",
      includeSearchTerms: environment.GOOGLE_ADS_INCLUDE_SEARCH_TERMS !== "false",
      includeEntityBreakdown:
        environment.GOOGLE_ADS_INCLUDE_ENTITY_BREAKDOWN !== "false",
      includeGeoBreakdown: environment.GOOGLE_ADS_INCLUDE_GEO_BREAKDOWN !== "false",
      includeAudienceBreakdown:
        environment.GOOGLE_ADS_INCLUDE_AUDIENCE_BREAKDOWN !== "false",
      includeImpressionShare:
        environment.GOOGLE_ADS_INCLUDE_IMPRESSION_SHARE !== "false",
      includeDeviceBreakdown:
        environment.GOOGLE_ADS_INCLUDE_DEVICE_BREAKDOWN !== "false",
    },
  };
}

/** Reads stored credential rows; injectable so the loader can be tested offline. */
export interface StoredCredentialReaders {
  /** This brand's own active row, or null. */
  own: (clientSlug: string) => Promise<StoredCredentialRecordLike | null>;
  /** The most recent active row held on this manager, or null. */
  manager: (managerId: string) => Promise<StoredCredentialRecordLike | null>;
}

/**
 * The stored credential sets this brand should use, own row first.
 *
 * The manager's set is fetched only when the brand has no refresh token of its
 * own anywhere — not in its row and not in the environment. That is the same
 * condition under which the connector already borrows a manager's refresh
 * token; borrowing the manager's saved client alongside it keeps the pair
 * valid instead of mixing the manager's grant with the deployment's client.
 */
async function loadStoredCredentials(
  clientSlug: string,
  environment: Environment,
  readers: StoredCredentialReaders,
): Promise<{
  own: StoredGoogleAdsCredentials | null;
  manager: StoredGoogleAdsCredentials | null;
}> {
  const ownRecord = await readers.own(clientSlug);
  const own = readStoredGoogleAdsCredentials(ownRecord);
  if (own) return { own, manager: null };

  const isPilot = clientSlug === PILOT_CLIENT_SLUG;
  const hasOwnRefreshToken = Boolean(
    storedSecret(ownRecord?.refreshToken) ||
      read(
        environment,
        googleAdsEnvKey("GOOGLE_ADS_REFRESH_TOKEN", clientSlug),
        isPilot ? "GOOGLE_ADS_REFRESH_TOKEN" : null,
      ),
  );
  if (hasOwnRefreshToken) return { own: null, manager: null };

  const managerId = normalizeGoogleCustomerId(
    read(
      environment,
      googleAdsEnvKey("GOOGLE_ADS_LOGIN_CUSTOMER_ID", clientSlug),
      "GOOGLE_ADS_LOGIN_CUSTOMER_ID",
    ) ?? ownRecord?.mccId,
  );
  if (!managerId) return { own: null, manager: null };

  return {
    own: null,
    manager: readStoredGoogleAdsCredentials(await readers.manager(managerId)),
  };
}

/**
 * Resolves a brand's configuration against the stored credential registry.
 * If the registry cannot be read the brand is refused: without it neither the
 * priority-1 id nor a collision can be checked, and a saved credential set
 * could silently lose to the environment.
 */
export async function loadGoogleAdsConfig(
  clientSlug: string,
  environment: Environment = process.env,
  listStoredCustomerIds?: (platform: string) => Promise<StoredCustomerId[]>,
  listHistoricalCustomerIds?: () => Promise<StoredCustomerId[]>,
  credentialReaders?: StoredCredentialReaders,
): Promise<GoogleAdsConfigResolution> {
  let storedCustomerIds: StoredCustomerId[];
  let historicalCustomerIds: StoredCustomerId[] = [];
  let storedCredentials: {
    own: StoredGoogleAdsCredentials | null;
    manager: StoredGoogleAdsCredentials | null;
  } = { own: null, manager: null };
  try {
    const storage = await import("./token-storage");
    const listStored =
      listStoredCustomerIds ?? storage.listActiveConnectorCustomerIds;
    const listHistorical = listHistoricalCustomerIds ??
      (listStoredCustomerIds
        ? async () => []
        : storage.listLatestHistoricalGoogleCustomerIds);
    // A caller that injects the id registry is testing resolution offline; it
    // gets no stored sets unless it injects those readers too.
    const readers: StoredCredentialReaders = credentialReaders ??
      (listStoredCustomerIds
        ? { own: async () => null, manager: async () => null }
        : {
            own: (slug) => storage.getConnectorToken(GOOGLE_ADS_TOKEN_PLATFORM, slug),
            manager: (managerId) =>
              storage.getManagerScopedCredentialRecord(
                GOOGLE_ADS_TOKEN_PLATFORM,
                managerId,
              ),
          });
    [storedCustomerIds, historicalCustomerIds, storedCredentials] = await Promise.all([
      listStored(GOOGLE_ADS_TOKEN_PLATFORM),
      listHistorical(),
      loadStoredCredentials(clientSlug.trim(), environment, readers),
    ]);
  } catch {
    return {
      ok: false,
      clientSlug: clientSlug.trim(),
      state: "registry-unavailable",
      missing: [],
      safeMessage:
        "The stored Google Ads account registry is unavailable, so this brand's customer id cannot be verified. Sync refused.",
    };
  }

  return resolveGoogleAdsConfig(clientSlug, {
    storedCustomerIds,
    historicalCustomerIds,
    environment,
    storedCredentials,
  });
}
