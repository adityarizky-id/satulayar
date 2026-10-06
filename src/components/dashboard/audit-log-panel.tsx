"use client";

import {
  memo,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type SVGProps,
} from "react";

import {
  CheckIcon,
  ChevronIcon,
  CloseIcon,
  DownloadIcon,
  PlugIcon,
  RefreshIcon,
  SearchIcon,
} from "@/components/dashboard/icons";

import {
  describeAuditEvent,
  type AuditAction,
  type AuditEventRecord,
} from "@/lib/audit/types";
import type { DashboardViewer } from "@/lib/auth/types";

interface AuditLogPanelProps {
  entries: AuditEventRecord[];
  viewer: DashboardViewer;
  /** True when the entries are examples for local preview, not recorded events. */
  isSample?: boolean;
}

type AuditFilter = "all" | "export" | "sync" | "connector";

type AuditIcon = ComponentType<SVGProps<SVGSVGElement>>;

const ACTION_CONFIG: Record<
  AuditAction,
  { label: string; badgeClass: string; icon: AuditIcon }
> = {
  "audience.export": {
    label: "Audience export",
    badgeClass: "audit-badge--export",
    icon: DownloadIcon,
  },
  "sync.manual": {
    label: "Manual refresh",
    badgeClass: "audit-badge--sync",
    icon: RefreshIcon,
  },
  "sync.backfill": {
    label: "Historical backfill",
    badgeClass: "audit-badge--backfill",
    icon: RefreshIcon,
  },
  "sync.scheduled": {
    label: "Scheduled refresh",
    badgeClass: "audit-badge--scheduled",
    icon: RefreshIcon,
  },
  "connector.connected": {
    label: "Connector linked",
    badgeClass: "audit-badge--auth",
    icon: PlugIcon,
  },
  "connector.disconnected": {
    label: "Connector revoked",
    badgeClass: "audit-badge--revoke",
    icon: PlugIcon,
  },
  "connector.credentials_saved": {
    label: "Credentials saved",
    badgeClass: "audit-badge--auth",
    icon: PlugIcon,
  },
};

const OUTCOME_LABELS: Record<string, { label: string; className: string }> = {
  succeeded: { label: "Succeeded", className: "audit-outcome--success" },
  failed: { label: "Failed", className: "audit-outcome--failed" },
  denied: { label: "Denied", className: "audit-outcome--denied" },
};

const FILTER_LABELS: Record<AuditFilter, string> = {
  all: "All activity",
  export: "Audience exports",
  sync: "Data refreshes",
  connector: "Connections",
};

function formatRole(role: string): string {
  return role
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export const AuditLogPanel = memo(function AuditLogPanel({
  entries,
  viewer,
  isSample = false,
}: AuditLogPanelProps) {
  const [activeFilter, setActiveFilter] = useState<AuditFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  const filterCounts = useMemo<Record<AuditFilter, number>>(
    () => ({
      all: entries.length,
      export: entries.filter((entry) => entry.action === "audience.export").length,
      sync: entries.filter((entry) => entry.action.startsWith("sync.")).length,
      connector: entries.filter((entry) => entry.action.startsWith("connector.")).length,
    }),
    [entries],
  );

  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => {
      if (activeFilter === "export" && entry.action !== "audience.export") {
        return false;
      }
      if (
        activeFilter === "sync" &&
        entry.action !== "sync.manual" &&
        entry.action !== "sync.backfill" &&
        entry.action !== "sync.scheduled"
      ) {
        return false;
      }
      if (
        activeFilter === "connector" &&
        entry.action !== "connector.connected" &&
        entry.action !== "connector.disconnected"
      ) {
        return false;
      }

      const q = searchQuery.trim().toLowerCase();
      if (!q) return true;

      const searchableText = [
        describeAuditEvent(entry),
        ACTION_CONFIG[entry.action]?.label,
        entry.action,
        entry.subject,
        entry.actorEmail,
        entry.actorRole ? formatRole(entry.actorRole) : null,
        entry.outcome,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return searchableText.includes(q);
    });
  }, [entries, activeFilter, searchQuery]);

  const canViewFullDetails =
    viewer.role === "admin" || viewer.role === "internal_editor";
  const isFiltered = activeFilter !== "all" || searchQuery.trim().length > 0;

  return (
    <section
      className="audit-console-panel"
      id="activity-audit-log"
      aria-labelledby="audit-panel-title"
    >
      <header className="audit-console-header">
        <div className="audit-console-title-group">
          <div className="audit-console-title-row">
            <h2 id="audit-panel-title">Activity audit log</h2>
            <div className="audit-console-badge-row" role="group" aria-label="Audit policy">
              {isSample && (
                <span className="signal-chip signal-chip--info">
                  <span aria-hidden="true" className="signal-chip__dot" />
                  Sample activity
                </span>
              )}
              <span className="signal-chip signal-chip--connected">
                <span aria-hidden="true" className="signal-chip__dot" />
                Append-only
              </span>
              <span
                className="audit-retention-pill"
                title="Customer-data audit retention and handling class"
              >
                GDPR Class B
              </span>
            </div>
          </div>
          <p className="audit-console-description">
            A permanent record of customer-data exports, data refreshes, and connector
            access changes.
          </p>
          {isSample && (
            <p className="audit-console-description">
              These events are examples for the local preview. Real activity appears
              here once sign-in and connectors are live.
            </p>
          )}
        </div>

        <div className="audit-console-search-wrapper">
          <SearchIcon className="audit-search-icon" width={16} height={16} />
          <label htmlFor="audit-search-field" className="visually-hidden">
            Search the activity audit log
          </label>
          <input
            id="audit-search-field"
            ref={searchInputRef}
            type="search"
            placeholder="Search actor, action or platform"
            className="audit-search-input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              className="audit-search-clear"
              aria-label="Clear audit search"
              onClick={() => {
                setSearchQuery("");
                searchInputRef.current?.focus();
              }}
            >
              <CloseIcon width={15} height={15} />
            </button>
          )}
        </div>
      </header>

      <div className="audit-filter-bar">
        <div className="audit-tab-filter" role="group" aria-label="Filter audit log">
          {(Object.keys(FILTER_LABELS) as AuditFilter[]).map((filter) => (
            <button
              key={filter}
              type="button"
              aria-label={`${FILTER_LABELS[filter]}, ${filterCounts[filter]} ${
                filterCounts[filter] === 1 ? "event" : "events"
              }`}
              aria-pressed={activeFilter === filter}
              className={`audit-tab-btn ${activeFilter === filter ? "audit-tab-btn--active" : ""}`}
              onClick={() => setActiveFilter(filter)}
            >
              <span>{FILTER_LABELS[filter]}</span>
              <span className="audit-tab-count" aria-hidden="true">
                {filterCounts[filter]}
              </span>
            </button>
          ))}
        </div>
        <p
          aria-atomic="true"
          aria-live="polite"
          className="audit-results-count"
          role="status"
        >
          {isFiltered
            ? `${filteredEntries.length} of ${entries.length} events`
            : `${entries.length} ${entries.length === 1 ? "event" : "events"}`} · Newest
          first
        </p>
      </div>

      <div className="audit-feed-wrapper">
        {entries.length === 0 ? (
          <div className="audit-empty-state">
            <CheckIcon className="audit-empty-icon" width={24} height={24} />
            <strong>No recorded activity yet</strong>
            <p>
              Audience exports, data refreshes, and connector changes appear here as
              they happen.
            </p>
          </div>
        ) : filteredEntries.length === 0 ? (
          <div className="audit-empty-state">
            <SearchIcon className="audit-empty-icon" width={24} height={24} />
            <strong>No matching activity</strong>
            <p>Try a different filter or clear your search.</p>
            {isFiltered && (
              <button
                className="console-button console-button--quiet"
                onClick={() => {
                  setActiveFilter("all");
                  setSearchQuery("");
                  searchInputRef.current?.focus();
                }}
                type="button"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <ol className="audit-feed-list">
            {filteredEntries.map((entry) => {
              const cfg = ACTION_CONFIG[entry.action] ?? {
                label: entry.action,
                badgeClass: "audit-badge--neutral",
                icon: PlugIcon,
              };
              const EventIcon = cfg.icon;
              const outcome = OUTCOME_LABELS[entry.outcome] ?? {
                label: entry.outcome,
                className: "",
              };
              const formattedDate = new Date(entry.createdAt).toLocaleString("en-GB", {
                day: "2-digit",
                month: "short",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                timeZone: "Asia/Jakarta",
                timeZoneName: "short",
              });

              return (
                <li key={entry.id} className="audit-feed-item">
                  <div className="audit-feed-item__rail" aria-hidden="true">
                    <span className={`audit-event-icon ${cfg.badgeClass}`}>
                      <EventIcon width={15} height={15} />
                    </span>
                  </div>

                  <div className="audit-feed-item__body">
                    <div className="audit-feed-item__header">
                      <div className="audit-feed-item__event-meta">
                        <span className={`audit-badge ${cfg.badgeClass}`}>{cfg.label}</span>
                        <time
                          dateTime={entry.createdAt}
                          className="audit-timestamp"
                          title={new Date(entry.createdAt).toISOString()}
                        >
                          {formattedDate}
                        </time>
                      </div>
                      <span
                        aria-label={`Outcome: ${outcome.label}`}
                        className={`audit-outcome-chip ${outcome.className}`}
                      >
                        {entry.outcome === "succeeded" && (
                          <CheckIcon width={13} height={13} />
                        )}
                        {entry.outcome !== "succeeded" && (
                          <CloseIcon width={13} height={13} />
                        )}
                        {outcome.label}
                      </span>
                    </div>

                    <p className="audit-feed-item__sentence">
                      {describeAuditEvent(entry)}
                    </p>

                    <div className="audit-feed-item__meta-row">
                      <span className="audit-actor-chip">
                        By <strong>{entry.actorEmail ?? "System scheduler"}</strong>
                      </span>
                      {entry.actorRole && (
                        <span className="audit-role-chip">{formatRole(entry.actorRole)}</span>
                      )}
                    </div>

                    {canViewFullDetails && Object.keys(entry.detail).length > 0 && (
                      <details className="audit-detail-drawer">
                        <summary className="audit-detail-summary">
                          <ChevronIcon
                            aria-hidden="true"
                            className="audit-detail-chevron"
                            width={14}
                            height={14}
                          />
                          <span className="audit-detail-summary__closed">View technical details</span>
                          <span className="audit-detail-summary__open">Hide technical details</span>
                        </summary>
                        <pre className="audit-detail-pre">
                          {JSON.stringify(entry.detail, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <footer className="audit-console-footer">
        <CheckIcon className="audit-security-icon" width={15} height={15} />
        <span className="audit-security-note">
          {isSample
            ? "Sample events for the local preview. Recorded activity is server-written and append-only."
            : "Server-written and append-only. Entries cannot be edited or deleted."}
        </span>
      </footer>
    </section>
  );
});
