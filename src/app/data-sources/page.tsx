import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  DataSourcesShell,
  type DataSourceCard,
} from "@/components/dashboard/data-sources-shell";
import type { LongLivedCredential } from "@/components/dashboard/connector-console";
import { hasPermission } from "@/lib/auth/authorization";
import { resolveActiveClientSlug } from "@/lib/auth/client-scope";
import { resolveAuthContext } from "@/lib/auth/session";
import { resolveGa4PropertyId } from "@/lib/connectors/ga4-sync";
import { buildConnectorHealthReport } from "@/lib/connectors/health";
import {
  getLatestConnectorTokenUpdatedAt,
} from "@/lib/connectors/token-storage";
import { ACCOUNT_COOKIE, resolveAccount } from "@/lib/dashboard/accounts";
import { getDashboardDataConfiguration } from "@/lib/dashboard/validation";
import { createServiceClient } from "@/lib/supabase/server";
import { BrandGlyph } from "@/components/dashboard/brand-mark";

export const dynamic = "force-dynamic";

const SOURCES: Omit<
  DataSourceCard,
  "lastSyncedAt" | "status" | "statusNote" | "targetAccount"
>[] = [
  {
    id: "google-ads",
    name: "Google Ads",
    purpose: "Paid search and Performance Max",
    testable: true,
    // Connected per brand from the in-page form, so a brand never waits on the
    // deployment's environment to be edited. The OAuth route remains for any
    // caller that still uses it, but the page no longer sends anyone there.
    connectMethod: "credentials",
  },
  {
    id: "meta-ads",
    name: "Meta Ads",
    purpose: "Paid social reporting",
  },
  {
    id: "google-analytics",
    name: "Google Analytics 4",
    purpose: "Site behaviour and attribution",
  },
  {
    id: "google-search-console",
    name: "Google Search Console",
    purpose: "Organic search queries and indexing coverage",
  },
  {
    id: "shopify",
    name: "Shopify Store",
    purpose: "E-commerce store catalog and order sync",
  },
  {
    id: "woocommerce",
    name: "WooCommerce Store",
    purpose: "E-commerce orders and store performance",
  },
  {
    id: "bing-ads",
    name: "Microsoft Advertising",
    purpose: "Paid search expansion",
  },
  {
    id: "tiktok-ads",
    name: "TikTok Ads",
    purpose: "Paid social expansion",
  },
];

const PLANNED_SOURCE_IDS = new Set([
  "bing-ads",
  "tiktok-ads",
  "google-search-console",
  "shopify",
  "woocommerce",
]);

interface SafeConnectorTelemetry {
  record: SafeConnectorTokenRow | null;
  unavailable: boolean;
}

interface SafeConnectorTokenRow {
  platform: string;
  mcc_id: string | null;
  customer_id: string | null;
  expires_at: string | null;
  updated_at: string;
}

const DAY_IN_MILLISECONDS = 86_400_000;

function resolveLongLivedCredential(
  record: SafeConnectorTokenRow | null,
  now = Date.now(),
): LongLivedCredential | undefined {
  if (record?.platform !== "meta-ads") return undefined;
  if (!record.expires_at) {
    return {
      kind: "long-lived-access-token",
      state: "expiry-unknown",
      daysRemaining: null,
      expiresAt: null,
    };
  }

  const expiresAt = Date.parse(record.expires_at);
  if (!Number.isFinite(expiresAt)) {
    return {
      kind: "long-lived-access-token",
      state: "expiry-unknown",
      daysRemaining: null,
      expiresAt: null,
    };
  }

  if (expiresAt <= now) {
    return {
      kind: "long-lived-access-token",
      state: "expired",
      daysRemaining: 0,
      expiresAt: record.expires_at,
    };
  }

  return {
    kind: "long-lived-access-token",
    state: "active",
    daysRemaining: Math.ceil((expiresAt - now) / DAY_IN_MILLISECONDS),
    expiresAt: record.expires_at,
  };
}

function maskAccountId(value: string): string {
  const normalized = value.replace(/\D/g, "");
  if (!normalized) return "Configured account";
  return `•••• ${normalized.slice(-4)}`;
}

function resolveTargetAccount(
  record: SafeConnectorTokenRow,
  clientSlug: string,
): string | null {
  if (record.platform === "google-analytics") {
    // The brand's own property, never the pilot's unsuffixed fallback for
    // another brand's card.
    const propId = record.customer_id || resolveGa4PropertyId(clientSlug);
    if (propId) return `Property ${maskAccountId(propId)}`;
    return "GA4 Property";
  }
  if (record.customer_id) return `Customer ${maskAccountId(record.customer_id)}`;
  if (record.mcc_id) return `MCC ${maskAccountId(record.mcc_id)}`;
  return null;
}

async function readConnectorTelemetryFor(
  clientSlug: string,
  platform: string,
): Promise<SafeConnectorTelemetry> {
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("connector_tokens")
      .select("platform, mcc_id, customer_id, expires_at, updated_at")
      .eq("platform", platform)
      .eq("client_slug", clientSlug)
      .eq("status", "active")
      .maybeSingle();

    if (error) throw new Error("Connector telemetry unavailable.");
    return {
      record: data as SafeConnectorTokenRow | null,
      unavailable: false,
    };
  } catch {
    return { record: null, unavailable: true };
  }
}

export default async function DataSourcesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // The brand is resolved first and the session is checked against it, the
  // same order the dashboard uses. An explicit ?account= is validated strictly;
  // the selector cookie falls back to the pilot when stale.
  const [params, cookieStore] = await Promise.all([searchParams, cookies()]);
  const scope = resolveActiveClientSlug({
    requested: params.account,
    cookie: cookieStore.get(ACCOUNT_COOKIE)?.value,
  });

  if (!scope.ok) {
    return (
      <main className="route-state">
        <span className="route-state__mark route-state__mark--error"><BrandGlyph className="route-state__glyph" /></span>
        <h1>Unknown client.</h1>
        <p>{scope.message}</p>
      </main>
    );
  }

  const clientSlug = scope.clientSlug;
  const auth = await resolveAuthContext(clientSlug);

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

  const readConnectorTelemetry = (platform: string) =>
    readConnectorTelemetryFor(clientSlug, platform);

  const configuration = getDashboardDataConfiguration();
  const health = hasPermission(auth.context.access.role, "sync:trigger")
    ? await buildConnectorHealthReport({
        mode: configuration.mode,
        storage: configuration.storage,
        environment: process.env,
      })
    : null;

  let lastDataSyncAt: string | null = null;
  let tokenTelemetry = new Map<string, SafeConnectorTelemetry>();

  if (auth.context.mode === "supabase") {
    const [latest, google, meta, ga4] = await Promise.all([
      getLatestConnectorTokenUpdatedAt(clientSlug).catch(() => null),
      readConnectorTelemetry("google-ads"),
      readConnectorTelemetry("meta-ads"),
      readConnectorTelemetry("google-analytics"),
    ]);
    lastDataSyncAt = latest;
    tokenTelemetry = new Map([
      ["google-ads", google],
      ["meta-ads", meta],
      ["google-analytics", ga4],
    ]);
  }

  const sources: DataSourceCard[] = SOURCES.map((source) => {
    const isPlanned = PLANNED_SOURCE_IDS.has(source.id);
    const telemetry = tokenTelemetry.get(source.id);
    const record = telemetry?.record ?? null;
    const credential = resolveLongLivedCredential(record);
    const credentialExpired = credential?.state === "expired";

    return {
      ...source,
      status: isPlanned
        ? "planned"
        : telemetry?.unavailable
          ? "unverified"
          : credentialExpired
            ? "error"
          : record
            ? "connected"
            : "disconnected",
      statusNote: isPlanned
        ? "Not available in this release"
        : telemetry?.unavailable
          ? "Connection status can't be checked on this deployment"
          : credentialExpired
            ? "Long-lived access token expired"
          : record
            ? "Credential stored and active"
            : "No active credential",
      // The credential's own timestamp, not a data sync: the column says so.
      lastSyncedAt: record?.updated_at ?? null,
      targetAccount: record ? resolveTargetAccount(record, clientSlug) : null,
      credential,
    };
  });

  return (
    <DataSourcesShell
      accountName={resolveAccount(clientSlug).name}
      clientSlug={clientSlug}
      health={health}
      lastDataSyncAt={lastDataSyncAt}
      sources={sources}
      syncTimeZone={resolveAccount(clientSlug).timezone}
      viewer={{
        email: auth.context.email,
        mode: auth.context.mode,
        role: auth.context.access.role,
      }}
    />
  );
}
