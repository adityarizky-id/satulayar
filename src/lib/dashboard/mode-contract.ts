/**
 * Display-mode contract for the dashboard shell.
 *
 * This is deliberately separate from the ingestion mode (`mock | live`). The
 * ingestion mode answers where persisted facts come from; this display mode
 * answers which dataset the operator has intentionally chosen to inspect.
 */

export type DashboardDataDisplayMode = "live" | "dummy";

export const DASHBOARD_DATA_MODE_QUERY_PARAM = "dataMode";
export const DASHBOARD_DATA_MODE_STORAGE_KEY =
  "satulayar:data-display-mode:v1";
export const DEFAULT_DASHBOARD_DATA_DISPLAY_MODE: DashboardDataDisplayMode =
  "live";

export type DashboardDataModeResolutionSource =
  | "url"
  | "local-storage"
  | "default";

export interface DashboardDataModeResolution {
  mode: DashboardDataDisplayMode;
  source: DashboardDataModeResolutionSource;
}

export interface DashboardDataModeState extends DashboardDataModeResolution {
  revision: number;
}

export type DashboardDataModeEvent =
  | { type: "toggle" }
  | { type: "select"; mode: DashboardDataDisplayMode }
  | {
      type: "hydrate";
      urlSearch?: string | URLSearchParams | null;
      localStorageValue?: unknown;
    }
  | { type: "reset" };

export type DashboardModeRefreshEffect =
  | "sync-live-connectors"
  | "regenerate-dummy-snapshot";

export type DashboardModeRangeEffect =
  | "query-live-range"
  | "rebuild-dummy-range";

export type DashboardModeAnomalyPolicy =
  | "validated-live-only"
  | "simulation-only";

export interface DashboardModeActionBehavior {
  refresh: {
    effect: DashboardModeRefreshEffect;
    requiresSyncPermission: boolean;
    label: string;
  };
  syncTimePill: {
    source: "latest-persisted-sync" | "snapshot-generated-at";
    label: string;
  };
  statusDot: {
    source: "live-data-health" | "fixed-informational";
    label: string;
    tone: "dynamic" | "informational";
  };
  rangePicker: {
    enabled: true;
    effect: DashboardModeRangeEffect;
  };
  anomalyAlert: {
    policy: DashboardModeAnomalyPolicy;
    actionable: boolean;
    suppressWhenProvisional: boolean;
    label: string;
  };
}

/**
 * Canonical behavior matrix consumed by topbars and dashboard shells.
 *
 * Dummy mode may demonstrate the complete interaction, but it may never emit
 * an operational alert or invoke a connector. Live anomalies remain
 * actionable only after the underlying data-quality contract passes.
 */
export const DASHBOARD_DATA_MODE_BEHAVIOR = {
  live: {
    refresh: {
      effect: "sync-live-connectors",
      requiresSyncPermission: true,
      label: "Refresh data",
    },
    syncTimePill: {
      source: "latest-persisted-sync",
      label: "Synced",
    },
    statusDot: {
      source: "live-data-health",
      label: "Live data",
      tone: "dynamic",
    },
    rangePicker: {
      enabled: true,
      effect: "query-live-range",
    },
    anomalyAlert: {
      policy: "validated-live-only",
      actionable: true,
      suppressWhenProvisional: true,
      label: "Live anomaly",
    },
  },
  dummy: {
    refresh: {
      effect: "regenerate-dummy-snapshot",
      requiresSyncPermission: false,
      label: "Regenerate dummy data",
    },
    syncTimePill: {
      source: "snapshot-generated-at",
      label: "Generated",
    },
    statusDot: {
      source: "fixed-informational",
      label: "Dummy data",
      tone: "informational",
    },
    rangePicker: {
      enabled: true,
      effect: "rebuild-dummy-range",
    },
    anomalyAlert: {
      policy: "simulation-only",
      actionable: false,
      suppressWhenProvisional: false,
      label: "Simulated anomaly",
    },
  },
} as const satisfies Record<
  DashboardDataDisplayMode,
  DashboardModeActionBehavior
>;

export function isDashboardDataDisplayMode(
  value: unknown,
): value is DashboardDataDisplayMode {
  return value === "live" || value === "dummy";
}

export function validateDashboardDataDisplayMode(
  value: unknown,
): DashboardDataDisplayMode | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return isDashboardDataDisplayMode(normalized) ? normalized : null;
}

function searchParamsFrom(
  search: string | URLSearchParams | null | undefined,
): URLSearchParams {
  if (search instanceof URLSearchParams) return new URLSearchParams(search);
  return new URLSearchParams((search ?? "").replace(/^\?/, ""));
}

export function resolveDashboardDataDisplayMode(input: {
  urlSearch?: string | URLSearchParams | null;
  localStorageValue?: unknown;
  fallback?: DashboardDataDisplayMode;
}): DashboardDataModeResolution {
  const urlValue = validateDashboardDataDisplayMode(
    searchParamsFrom(input.urlSearch).get(DASHBOARD_DATA_MODE_QUERY_PARAM),
  );
  if (urlValue) return { mode: urlValue, source: "url" };

  const storedValue = validateDashboardDataDisplayMode(input.localStorageValue);
  if (storedValue) return { mode: storedValue, source: "local-storage" };

  return {
    mode: input.fallback ?? DEFAULT_DASHBOARD_DATA_DISPLAY_MODE,
    source: "default",
  };
}

/** Serializes a shareable query string containing only the mode contract. */
export function serializeDashboardDataDisplayMode(
  mode: DashboardDataDisplayMode,
): string {
  return `?${DASHBOARD_DATA_MODE_QUERY_PARAM}=${encodeURIComponent(mode)}`;
}

/** Writes the mode into an existing query string without dropping filters. */
export function withDashboardDataDisplayMode(
  search: string | URLSearchParams | null | undefined,
  mode: DashboardDataDisplayMode,
): string {
  const params = searchParamsFrom(search);
  params.set(DASHBOARD_DATA_MODE_QUERY_PARAM, mode);
  const serialized = params.toString();
  return serialized ? `?${serialized}` : "";
}

export function serializeDashboardDataModeStorage(
  mode: DashboardDataDisplayMode,
): { key: typeof DASHBOARD_DATA_MODE_STORAGE_KEY; value: DashboardDataDisplayMode } {
  return { key: DASHBOARD_DATA_MODE_STORAGE_KEY, value: mode };
}

export function createDashboardDataModeState(input: {
  urlSearch?: string | URLSearchParams | null;
  localStorageValue?: unknown;
  fallback?: DashboardDataDisplayMode;
} = {}): DashboardDataModeState {
  return {
    ...resolveDashboardDataDisplayMode(input),
    revision: 0,
  };
}

export function transitionDashboardDataMode(
  state: DashboardDataModeState,
  event: DashboardDataModeEvent,
): DashboardDataModeState {
  if (event.type === "hydrate") {
    const resolved = resolveDashboardDataDisplayMode(event);
    if (resolved.mode === state.mode && resolved.source === state.source) return state;
    return { ...resolved, revision: state.revision + 1 };
  }

  const nextMode =
    event.type === "toggle"
      ? state.mode === "live"
        ? "dummy"
        : "live"
      : event.type === "select"
        ? event.mode
        : DEFAULT_DASHBOARD_DATA_DISPLAY_MODE;

  if (nextMode === state.mode && state.source === "url") return state;

  return {
    mode: nextMode,
    // A user transition is immediately shareable through the URL serializer.
    source: "url",
    revision: state.revision + 1,
  };
}
