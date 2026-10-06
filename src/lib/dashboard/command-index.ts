import { hasPermission } from "@/lib/auth/authorization";
import type { AppRole, DashboardPermission } from "@/lib/auth/types";
import { ACCOUNT_OPTIONS } from "@/lib/dashboard/accounts";
import { isSectionVisible } from "@/lib/dashboard/sections";
import type { Platform } from "@/lib/dashboard/types";

/**
 * Index behind the Cmd+K palette.
 *
 * Two rules shape it. The palette is built from the role, never filtered in the
 * component: an entry a viewer must not have is absent from the list rather
 * than hidden by styling. And the index is navigation and intent only — the
 * route each command targets performs its own permission check, because a
 * palette entry is a suggestion, not an authorisation.
 */

export type CommandGroup =
  | "Accounts"
  | "Platforms"
  | "Sections"
  | "Operations"
  | "Exports";

export interface CommandEntry {
  id: string;
  label: string;
  group: CommandGroup;
  /** What the palette should do: navigate, or set a dashboard filter. */
  action:
    | { kind: "navigate"; href: string }
    | { kind: "set-account"; slug: string }
    | { kind: "set-platform"; platform: Platform }
    | { kind: "scroll-to-section"; sectionId: string };
  /** Extra words that should still match this entry when typed. */
  keywords: string[];
  /** Absent for entries every signed-in reader may use. */
  requiredPermission?: DashboardPermission;
}

export interface CommandIndexInput {
  role: AppRole;
  /** Platform currently filtered; section entries follow its visibility rules. */
  platform: Platform;
  /** Section ids and labels rendered on the current page. */
  sections?: { id: string; label: string }[];
}

const PLATFORM_ENTRIES: { platform: Platform; label: string }[] = [
  { platform: "all", label: "All platforms" },
  { platform: "google", label: "Google Ads only" },
  { platform: "meta", label: "Meta Ads only" },
];

/**
 * Operational entries.
 *
 * The audience exports sit behind `audience:export`, a permission that exists
 * only for them: the file they produce is customer PII, and a viewer must never
 * be offered it. The executive summary keeps `summary:review`, because it
 * carries aggregate performance and no customer identity.
 */
const OPERATION_ENTRIES: CommandEntry[] = [
  {
    id: "operation:refresh",
    label: "Refresh data from the connectors",
    group: "Operations",
    action: { kind: "navigate", href: "/data-sources" },
    keywords: ["sync", "pull", "update", "connector"],
    requiredPermission: "sync:trigger",
  },
  {
    id: "operation:connectors",
    label: "Open data sources and connector health",
    group: "Operations",
    action: { kind: "navigate", href: "/data-sources" },
    keywords: ["oauth", "token", "connect", "health"],
    requiredPermission: "sync:trigger",
  },
  {
    id: "operation:worklog",
    label: "Add a worklog entry",
    group: "Operations",
    action: { kind: "navigate", href: "/worklog" },
    keywords: ["change", "note", "action", "log"],
    requiredPermission: "worklog:write",
  },
  {
    id: "operation:access",
    label: "Manage access and roles",
    group: "Operations",
    action: { kind: "navigate", href: "/account" },
    keywords: ["permission", "member", "role", "rbac"],
    requiredPermission: "access:manage",
  },
  {
    id: "export:executive-summary",
    label: "Copy the executive summary",
    group: "Exports",
    action: { kind: "navigate", href: "/?export=executive-summary" },
    keywords: ["summary", "whatsapp", "slack", "stakeholder", "report"],
    requiredPermission: "summary:review",
  },
  {
    id: "export:audience-meta",
    label: "Export the Meta value-based audience",
    group: "Exports",
    action: { kind: "navigate", href: "/store-analytics?export=meta-value-based" },
    keywords: ["customer match", "lookalike", "ltv", "csv", "audience"],
    requiredPermission: "audience:export",
  },
  {
    id: "export:audience-google",
    label: "Export the Google Customer Match list",
    group: "Exports",
    action: {
      kind: "navigate",
      href: "/store-analytics?export=google-customer-match",
    },
    keywords: ["customer match", "troas", "csv", "audience"],
    requiredPermission: "audience:export",
  },
  {
    id: "export:cohort-analytics",
    label: "Export the full cohort analytics CSV",
    group: "Exports",
    action: {
      kind: "navigate",
      href: "/store-analytics?export=full-cohort-analytics",
    },
    keywords: ["rfm", "cohort", "ltv", "aov", "spreadsheet"],
    requiredPermission: "audience:export",
  },
];

/**
 * Builds the palette index for one reader.
 *
 * Section entries are filtered by the same `isSectionVisible` rule the page
 * uses, so the palette can never scroll to a panel that is not rendered.
 */
export function buildCommandIndex(input: CommandIndexInput): CommandEntry[] {
  const entries: CommandEntry[] = [];

  for (const account of ACCOUNT_OPTIONS) {
    entries.push({
      id: `account:${account.slug}`,
      label: `Switch to ${account.name}`,
      group: "Accounts",
      action: { kind: "set-account", slug: account.slug },
      keywords: [account.slug, account.currency, account.timezone],
    });
  }

  for (const entry of PLATFORM_ENTRIES) {
    entries.push({
      id: `platform:${entry.platform}`,
      label: entry.label,
      group: "Platforms",
      action: { kind: "set-platform", platform: entry.platform },
      keywords: [entry.platform, "filter"],
    });
  }

  for (const section of input.sections ?? []) {
    if (!isSectionVisible(section.id, input.platform)) continue;
    entries.push({
      id: `section:${section.id}`,
      label: `Go to ${section.label}`,
      group: "Sections",
      action: { kind: "scroll-to-section", sectionId: section.id },
      keywords: [section.id, "section", "panel"],
    });
  }

  entries.push(...OPERATION_ENTRIES);

  return entries.filter(
    (entry) =>
      !entry.requiredPermission || hasPermission(input.role, entry.requiredPermission),
  );
}

/**
 * Ranks entries against typed text.
 *
 * A label prefix beats a label substring, which beats a keyword hit, so typing
 * "meta" surfaces the Meta platform filter before a section that merely
 * mentions Meta. An empty query returns the index unchanged.
 */
export function searchCommandIndex(
  entries: readonly CommandEntry[],
  query: string,
): CommandEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...entries];

  const scored: { entry: CommandEntry; score: number }[] = [];
  for (const entry of entries) {
    const label = entry.label.toLowerCase();
    let score = 0;
    if (label.startsWith(needle)) score = 3;
    else if (label.includes(needle)) score = 2;
    else if (entry.keywords.some((keyword) => keyword.toLowerCase().includes(needle))) {
      score = 1;
    }

    if (score > 0) scored.push({ entry, score });
  }

  return scored
    .toSorted((left, right) =>
      right.score !== left.score
        ? right.score - left.score
        : left.entry.label.localeCompare(right.entry.label),
    )
    .map((item) => item.entry);
}
