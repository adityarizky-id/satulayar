/**
 * Presentation helper for the "what is still missing" panel.
 *
 * Split out of `health.ts` for one reason, and it is a security reason rather
 * than a tidiness one. `health.ts` imports the provider catalog, and the
 * catalog reads `GOOGLE_ADS_CLIENT_SECRET`, `META_APP_SECRET`, and the rest at
 * module scope. The connector panel is a client component, so importing any
 * value from `health.ts` pulled that whole module graph into the browser
 * bundle.
 *
 * Nothing leaked: Next only inlines `NEXT_PUBLIC_*`, so those reads compiled
 * down to property access on the browser's `process` shim and evaluated to
 * undefined. But it left the client bundle one renamed variable away from
 * carrying a real secret, and a boundary that only holds by accident is not a
 * boundary. This module touches no credential and imports no connector, so the
 * panel can import it without dragging the catalog along.
 *
 * Variable *names* only. A value never passes through here.
 */

export interface MissingSettingGroup {
  label: string;
  settings: { key: string; hint?: string }[];
}

const SETTING_GROUPS: {
  label: string;
  matches: (key: string) => boolean;
}[] = [
  { label: "Dashboard runtime", matches: (key) => key.startsWith("DASHBOARD_") },
  { label: "Storage", matches: (key) => key.startsWith("SUPABASE_") },
  {
    label: "Conversion mapping",
    matches: (key) => key.endsWith("_CONVERSION_ACTION_ID"),
  },
  { label: "Google Ads API", matches: (key) => key.startsWith("GOOGLE_ADS_") },
];

const SETTING_HINTS: Record<string, string> = {
  DASHBOARD_DATA_MODE: "must be live",
  DASHBOARD_DATA_STORE: "must be supabase",
};

/**
 * Groups missing variable names by the job they do, so an operator reads
 * "storage key, API credentials, conversion mapping" instead of one run-on
 * list.
 */
export function groupMissingSettings(missing: string[]): MissingSettingGroup[] {
  const groups = new Map<string, MissingSettingGroup>();

  for (const key of missing) {
    const label =
      SETTING_GROUPS.find((group) => group.matches(key))?.label ?? "Other";
    const group = groups.get(label) ?? { label, settings: [] };
    group.settings.push(
      SETTING_HINTS[key] ? { key, hint: SETTING_HINTS[key] } : { key },
    );
    groups.set(label, group);
  }

  const order = [...SETTING_GROUPS.map((group) => group.label), "Other"];
  return [...groups.values()].toSorted(
    (left, right) => order.indexOf(left.label) - order.indexOf(right.label),
  );
}
