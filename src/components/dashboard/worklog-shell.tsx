"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

import { AccountSyncTime } from "@/components/dashboard/clocks";
import {
  AccountField,
  rememberAccount,
} from "@/components/dashboard/filter-fields";
import { ChevronIcon, WorklogPlatformIcon } from "@/components/dashboard/icons";
import { hasPermission } from "@/lib/auth/authorization";
import type { DashboardViewer } from "@/lib/auth/types";
import type { AccountOption } from "@/lib/dashboard/accounts";
import {
  WORKLOG_ACTION_TYPES,
  WORKLOG_PLATFORMS,
  WORKLOG_SCOPES,
  getWorklogDateKey,
  type WorklogRecord,
  type WorklogScope,
} from "@/lib/dashboard/worklog";
import type { WorklogPlatform } from "@/lib/dashboard/types";
import { AppFrame } from "@/components/dashboard/app-frame";
import {
  getMockPlatformChangeHistory,
  mapChangeEventToWorklogDraft,
  type PlatformChangeEvent,
} from "@/lib/dashboard/change-history";

export function formatPlatformLabel(platform: WorklogPlatform): string {
  switch (platform) {
    case "google":
      return "Google Ads";
    case "meta":
      return "Meta Ads";
    case "tiktok":
      return "TikTok Ads";
    case "ga4":
      return "GA4";
    case "bing":
      return "Microsoft Ads";
    case "all":
      return "All Platforms";
    case "other":
    default:
      return "Other";
  }
}

const SYNC_TABS: readonly { key: WorklogPlatform; label: string }[] = [
  { key: "all", label: "All Platforms" },
  { key: "google", label: "Google Ads" },
  { key: "meta", label: "Meta Ads" },
  { key: "tiktok", label: "TikTok Ads" },
  { key: "ga4", label: "GA4" },
  { key: "bing", label: "Microsoft Ads" },
];

const ACTION_TYPE_GROUPS = [
  {
    label: "Delivery controls",
    options: [
      "Budget change",
      "Bid or target change",
      "Audience change",
      "Keyword or negative",
    ],
  },
  {
    label: "Creative and experience",
    options: ["Creative rotation", "Landing page change"],
  },
  {
    label: "Structure and lifecycle",
    options: [
      "Tracking or measurement fix",
      "Structure change",
      "Campaign paused",
      "Campaign launched",
    ],
  },
  {
    label: "Context",
    options: ["External factor", "Other"],
  },
] as const satisfies readonly {
  label: string;
  options: readonly (typeof WORKLOG_ACTION_TYPES)[number][];
}[];

const APPROVAL_GRACE_PERIOD_MS = 5_000;

interface WorklogFormState {
  occurredOn: string;
  platform: WorklogPlatform;
  scope: WorklogScope;
  entityName: string;
  actionType: (typeof WORKLOG_ACTION_TYPES)[number];
  actionSummary: string;
  reasonOrHypothesis: string;
  status: "needs-review";
}

function createEmptyForm(
  occurredOn: string,
  platform: WorklogPlatform = "google",
): WorklogFormState {
  return {
    occurredOn,
    platform,
    scope: "campaign",
    entityName: "",
    actionType: WORKLOG_ACTION_TYPES[0],
    actionSummary: "",
    reasonOrHypothesis: "",
    status: "needs-review",
  };
}

function formatScopeLabel(scope: WorklogScope): string {
  return scope.charAt(0).toUpperCase() + scope.slice(1);
}

export function WorklogShell({
  accounts,
  selectedAccount,
  initialOccurredOn,
  initialEntries,
  viewer,
}: {
  accounts: AccountOption[];
  selectedAccount: string;
  initialOccurredOn: string;
  initialEntries: WorklogRecord[];
  viewer: DashboardViewer;
}) {
  const [account, setAccount] = useState(selectedAccount);
  const [entries, setEntries] = useState(initialEntries);
  const [form, setForm] = useState(() => createEmptyForm(initialOccurredOn));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState(() =>
    hasPermission(viewer.role, "summary:review")
      ? "New entries need review before they appear on the overview. You can publish them here."
      : "New entries need review before they appear on the overview. An admin can publish them.",
  );
  const [isSaving, setIsSaving] = useState(false);
  const [autofilledChangeId, setAutofilledChangeId] = useState<string | null>(null);
  const [pendingApproval, setPendingApproval] = useState<WorklogRecord | null>(null);
  const [queuedApproval, setQueuedApproval] = useState<WorklogRecord | null>(null);
  const approvalDialogRef = useRef<HTMLDialogElement>(null);
  const approvalTriggerRef = useRef<HTMLButtonElement | null>(null);
  const approvalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dateInputRef = useRef<HTMLInputElement>(null);

  // In-Platform Change History Sync State
  const [syncPlatform, setSyncPlatform] = useState<WorklogPlatform>("all");
  const [detectedChanges, setDetectedChanges] = useState<PlatformChangeEvent[]>(
    getMockPlatformChangeHistory(selectedAccount, "all"),
  );
  const [isSyncing, setIsSyncing] = useState(false);

  const canWrite = hasPermission(viewer.role, "worklog:write");
  const canApprove = hasPermission(viewer.role, "summary:review");

  useEffect(() => {
    const dialog = approvalDialogRef.current;
    if (!dialog) return;

    if (pendingApproval && !dialog.open) {
      dialog.showModal();
    } else if (!pendingApproval && dialog.open) {
      dialog.close();
    }
  }, [pendingApproval]);

  useEffect(
    () => () => {
      if (approvalTimerRef.current) clearTimeout(approvalTimerRef.current);
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    },
    [],
  );

  async function reload(slug: string) {
    try {
      const response = await fetch(`/api/worklogs?account=${slug}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        entries?: WorklogRecord[];
        error?: string;
      };
      if (!response.ok) {
        setMessage(payload.error ?? "Could not load this brand's worklog. Try again.");
        return;
      }
      setEntries(payload.entries ?? []);
      setDetectedChanges(getMockPlatformChangeHistory(slug, syncPlatform));
    } catch {
      setMessage("Could not reach the worklog service. Check your connection and try again.");
    }
  }

  const handlePullChanges = () => {
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    setIsSyncing(true);
    setMessage("Loading sample platform changes…");
    syncTimerRef.current = setTimeout(() => {
      const changes = getMockPlatformChangeHistory(account, syncPlatform);
      setDetectedChanges(changes);
      setIsSyncing(false);
      setMessage(
        `Loaded ${changes.length} sample ${changes.length === 1 ? "change" : "changes"} for ${
          syncPlatform === "all"
            ? "all available platforms"
            : formatPlatformLabel(syncPlatform)
        }.`,
      );
    }, 600);
  };

  const handleAutofillForm = (changeEvent: PlatformChangeEvent) => {
    const draft = mapChangeEventToWorklogDraft(changeEvent, account);
    setForm({
      occurredOn: draft.occurredOn,
      platform: draft.platform,
      scope: draft.scope,
      entityName: draft.entityName,
      actionType: draft.actionType,
      actionSummary: draft.actionSummary,
      reasonOrHypothesis: draft.reasonOrHypothesis,
      status: "needs-review",
    });
    setAutofilledChangeId(changeEvent.id);
    setFieldErrors({});
    setMessage(
      `Ready to review: ${draft.actionType} on "${draft.entityName}" (${formatPlatformLabel(
        draft.platform,
      )}).`,
    );
    const formEl = document.getElementById("worklog-form");
    const reduceMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    formEl?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
    requestAnimationFrame(() => dateInputRef.current?.focus({ preventScroll: true }));
  };

  function focusFirstError(errors: Record<string, string>) {
    const firstField = Object.keys(errors)[0];
    if (!firstField) return;
    requestAnimationFrame(() => {
      document.getElementById(`worklog-${firstField}`)?.focus();
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setFieldErrors({});

    try {
      const response = await fetch("/api/worklogs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, accountSlug: account }),
      });
      const payload = (await response.json()) as {
        entry?: WorklogRecord;
        error?: string;
        fields?: Record<string, string>;
      };

      if (!response.ok || !payload.entry) {
        const errors = payload.fields ?? {};
        setFieldErrors(errors);
        setMessage(
          payload.error ?? "This entry could not be saved. Review the marked fields and try again.",
        );
        focusFirstError(errors);
        return;
      }

      setEntries((current) => [payload.entry as WorklogRecord, ...current]);
      setForm(createEmptyForm(form.occurredOn, form.platform));
      if (autofilledChangeId) {
        setDetectedChanges((current) =>
          current.filter((change) => change.id !== autofilledChangeId),
        );
        setAutofilledChangeId(null);
      }
      setMessage("Saved as Needs review. Publish it when the context is ready for the overview.");
    } catch {
      setMessage(
        "Could not reach the worklog service. Your entry is still in the form; try again.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function publish(id: string) {
    setIsSaving(true);
    setMessage("Publishing the entry to the overview…");
    try {
      const response = await fetch("/api/worklogs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approveId: id }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setMessage(payload.error ?? "This entry could not be published. Try again.");
        return;
      }
      setEntries((current) =>
        current.map((entry) =>
          entry.id === id ? { ...entry, status: "approved" } : entry,
        ),
      );
      setMessage("Published. This entry now appears on the paid ads overview.");
    } catch {
      setMessage("Could not reach the worklog service. The entry was not published.");
    } finally {
      setIsSaving(false);
    }
  }

  function requestPublish(entry: WorklogRecord, trigger: HTMLButtonElement) {
    approvalTriggerRef.current = trigger;
    setPendingApproval(entry);
  }

  function queuePublish() {
    if (!pendingApproval) return;
    if (approvalTimerRef.current) clearTimeout(approvalTimerRef.current);

    const entry = pendingApproval;
    setPendingApproval(null);
    setQueuedApproval(entry);
    setMessage("Publication queued. Undo within five seconds to keep it in Needs review.");
    approvalTimerRef.current = setTimeout(() => {
      approvalTimerRef.current = null;
      setQueuedApproval(null);
      void publish(entry.id);
    }, APPROVAL_GRACE_PERIOD_MS);
  }

  function undoQueuedPublish() {
    if (approvalTimerRef.current) clearTimeout(approvalTimerRef.current);
    approvalTimerRef.current = null;
    setQueuedApproval(null);
    setMessage("Publication cancelled. The entry remains in Needs review.");
    requestAnimationFrame(() => approvalTriggerRef.current?.focus());
  }

  return (
    <AppFrame
      activeHref="/worklog"
      gateLabel={viewer.mode === "preview" ? "Preview storage" : "Secure storage"}
      gateNote={
        viewer.mode === "preview"
          ? "Entries are stored for this session in preview mode."
          : "Entries are stored in the active workspace."
      }
      topbar={
        <>
          <div className="topbar__context">
            <span className="status-dot" />
            <span>Worklog</span>
            <strong>
              {entries.length} {entries.length === 1 ? "entry" : "entries"}
            </strong>
          </div>
          <AccountSyncTime lastSyncAt={null} timeZone="Asia/Jakarta" />
        </>
      }
      viewer={viewer}
    >
      <section className="hero hero--worklog" id="worklog-overview">
        <div className="worklog-hero__copy">
          <h1>Record the decision behind every change.</h1>
          <p>
            Worklog entries add human context to performance shifts. They explain the
            numbers; they never alter them.
          </p>
        </div>
        <nav className="worklog-hero__actions" aria-label="Add a worklog entry">
          <strong>Add an entry</strong>
          <span>Start from your notes or review a sample platform change.</span>
          <div>
            <a className="button button--primary" href="#worklog-form">
              Log manually
            </a>
            <a className="button button--secondary" href="#change-history-importer">
              Review sample changes
            </a>
          </div>
        </nav>
      </section>

      <form className="filter-bar" onSubmit={(event) => event.preventDefault()}>
        <AccountField
          accounts={accounts}
          disabled={isSaving || Boolean(queuedApproval)}
          onChange={(slug) => {
            const selected = accounts.find((option) => option.slug === slug);
            const defaultPlatform = selected?.platforms.includes("google")
              ? "google"
              : (selected?.platforms[0] ?? "other");
            setAccount(slug);
            rememberAccount(slug);
            setForm(
              createEmptyForm(
                getWorklogDateKey(new Date(), selected?.timezone ?? "Asia/Jakarta"),
                defaultPlatform,
              ),
            );
            setFieldErrors({});
            setAutofilledChangeId(null);
            void reload(slug);
          }}
          value={account}
        />
        <p
          aria-atomic="true"
          aria-live="polite"
          className="filter-message"
          role="status"
        >
          {message}
        </p>
      </form>

      <section className="section" id="change-history-importer">
        <div className="section-heading section-heading--worklog">
          <div className="worklog-section-copy">
            <div className="worklog-section-title-row">
              <h2>Review platform changes</h2>
              <span className="worklog-sample-label">Sample data</span>
            </div>
            <p>
              Preview records shaped like Google Ads <code>change_event</code> and
              Meta <code>activities</code> data. Send one to the form, review the
              context, then save it.
            </p>
          </div>
        </div>

        <div className="worklog-stream-card" aria-busy={isSyncing}>
          <div className="worklog-stream-toolbar">
            <div
              className="worklog-stream-tabs"
              role="group"
              aria-label="Filter sample changes by platform"
            >
              {SYNC_TABS.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  aria-pressed={syncPlatform === tab.key}
                  onClick={() => {
                    setSyncPlatform(tab.key);
                    setDetectedChanges(getMockPlatformChangeHistory(account, tab.key));
                  }}
                  className={`worklog-stream-tab ${
                    syncPlatform === tab.key ? "worklog-stream-tab--active" : ""
                  }`}
                >
                  <WorklogPlatformIcon platform={tab.key} width={13} height={13} />
                  <span>{tab.label}</span>
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={handlePullChanges}
              disabled={isSyncing}
              className="button button--secondary worklog-stream-sync-btn"
              aria-busy={isSyncing}
            >
              <svg className={isSyncing ? "spin" : ""} viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="23 4 23 10 17 10" />
                <polyline points="1 20 1 14 7 14" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
              <span>{isSyncing ? "Loading samples…" : "Load sample changes"}</span>
            </button>
          </div>

          <div className="worklog-stream-content">
            {detectedChanges.length === 0 ? (
              <p className="worklog-stream-empty">
                No sample changes for this platform. Choose another platform to
                continue.
              </p>
            ) : (
              <div
                aria-label="Platform activity awaiting review"
                className="worklog-stream-table"
                role="table"
              >
                <div className="worklog-stream-table-head" role="row">
                  <span role="columnheader">Date</span>
                  <span role="columnheader">Ads platform</span>
                  <span role="columnheader">Activity log</span>
                  <span role="columnheader">Review</span>
                </div>
                <div className="worklog-stream-list" role="rowgroup">
                  {detectedChanges.map((change) => {
                    const dateFormatted =
                      change.platform === "google"
                        ? change.changeDateTime.split("T")[0]
                        : change.eventTime.split("T")[0];
                    const author =
                      change.platform === "google"
                        ? change.userEmail
                        : change.actorName;

                    return (
                      <div key={change.id} className="worklog-stream-item" role="row">
                        <div className="worklog-stream-item__date" role="cell">
                          <span className="worklog-stream-item__date-label">Date</span>
                          <time dateTime={dateFormatted}>{dateFormatted}</time>
                        </div>
                        <div className="worklog-stream-item__platform" role="cell">
                          <span
                            className={`worklog-stream-badge worklog-stream-badge--${change.platform}`}
                          >
                            <WorklogPlatformIcon
                              platform={change.platform}
                              width={13}
                              height={13}
                            />
                            <span>{formatPlatformLabel(change.platform)}</span>
                          </span>
                        </div>
                        <div className="worklog-stream-item__info" role="cell">
                          <strong className="worklog-stream-item__title">
                            {change.entityName}
                          </strong>
                          <p className="worklog-stream-item__desc">
                            {change.details}
                          </p>
                          <span className="worklog-stream-item__meta">
                            By {author}
                          </span>
                        </div>

                        <div className="worklog-stream-actions" role="cell">
                          <button
                            type="button"
                            onClick={() => handleAutofillForm(change)}
                            className="button button--primary worklog-stream-btn--autofill"
                          >
                            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <path d="M12 20h9" />
                              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                            </svg>
                            <span>Review in form</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="section" id="worklog-form">
        <div className="section-heading section-heading--worklog">
          <div className="worklog-section-copy">
            <h2>Log an action</h2>
            <p>
              Capture the change and the reasoning the team will need when reading
              performance later.
            </p>
          </div>
        </div>

        <form className="worklog-form" onSubmit={submit} aria-busy={isSaving}>
          <label className="field">
            <span>Date of the action</span>
            <input
              aria-describedby={fieldErrors.occurredOn ? "worklog-occurredOn-error" : undefined}
              aria-invalid={Boolean(fieldErrors.occurredOn)}
              id="worklog-occurredOn"
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  occurredOn: event.target.value,
                }))
              }
              ref={dateInputRef}
              type="date"
              value={form.occurredOn}
            />
            {fieldErrors.occurredOn && (
              <em className="field__error" id="worklog-occurredOn-error">
                {fieldErrors.occurredOn}
              </em>
            )}
          </label>

          <label className="field">
            <span>Platform</span>
            <span className="select-wrap">
              <select
                aria-describedby={fieldErrors.platform ? "worklog-platform-error" : undefined}
                aria-invalid={Boolean(fieldErrors.platform)}
                id="worklog-platform"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    platform: event.target.value as WorklogPlatform,
                  }))
                }
                value={form.platform}
              >
                {WORKLOG_PLATFORMS.map((platform) => (
                  <option key={platform.value} value={platform.value}>
                    {platform.label}
                  </option>
                ))}
              </select>
              <ChevronIcon />
            </span>
            {fieldErrors.platform && (
              <em className="field__error" id="worklog-platform-error">
                {fieldErrors.platform}
              </em>
            )}
          </label>

          <label className="field">
            <span>Scope</span>
            <span className="select-wrap">
              <select
                aria-describedby={fieldErrors.scope ? "worklog-scope-error" : undefined}
                aria-invalid={Boolean(fieldErrors.scope)}
                id="worklog-scope"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    scope: event.target.value as WorklogScope,
                  }))
                }
                value={form.scope}
              >
                {WORKLOG_SCOPES.map((scope) => (
                  <option key={scope} value={scope}>
                    {formatScopeLabel(scope)}
                  </option>
                ))}
              </select>
              <ChevronIcon />
            </span>
            {fieldErrors.scope && (
              <em className="field__error" id="worklog-scope-error">
                {fieldErrors.scope}
              </em>
            )}
          </label>

          <label className="field">
            <span>Campaign, ad group, or asset</span>
            <input
              aria-describedby={fieldErrors.entityName ? "worklog-entityName-error" : undefined}
              aria-invalid={Boolean(fieldErrors.entityName)}
              id="worklog-entityName"
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  entityName: event.target.value,
                }))
              }
              placeholder="GB | Kopi Senja Nusantara — Search Core"
              type="text"
              value={form.entityName}
            />
            {fieldErrors.entityName && (
              <em className="field__error" id="worklog-entityName-error">
                {fieldErrors.entityName}
              </em>
            )}
          </label>

          <label className="field">
            <span>Action type</span>
            <span className="select-wrap">
              <select
                aria-describedby={fieldErrors.actionType ? "worklog-actionType-error" : undefined}
                aria-invalid={Boolean(fieldErrors.actionType)}
                id="worklog-actionType"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    actionType: event.target
                      .value as (typeof WORKLOG_ACTION_TYPES)[number],
                  }))
                }
                value={form.actionType}
              >
                {ACTION_TYPE_GROUPS.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.options.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <ChevronIcon />
            </span>
            {fieldErrors.actionType && (
              <em className="field__error" id="worklog-actionType-error">
                {fieldErrors.actionType}
              </em>
            )}
          </label>

          <label className="field field--wide">
            <span>What changed</span>
            <textarea
              aria-describedby={fieldErrors.actionSummary ? "worklog-actionSummary-error" : undefined}
              aria-invalid={Boolean(fieldErrors.actionSummary)}
              id="worklog-actionSummary"
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  actionSummary: event.target.value,
                }))
              }
              placeholder="Cut daily budget from 60 to 40 and moved the rest to Search."
              rows={2}
              value={form.actionSummary}
            />
            {fieldErrors.actionSummary && (
              <em className="field__error" id="worklog-actionSummary-error">
                {fieldErrors.actionSummary}
              </em>
            )}
          </label>

          <label className="field field--wide">
            <span>Reason or hypothesis</span>
            <textarea
              aria-describedby={fieldErrors.reasonOrHypothesis ? "worklog-reasonOrHypothesis-error" : undefined}
              aria-invalid={Boolean(fieldErrors.reasonOrHypothesis)}
              id="worklog-reasonOrHypothesis"
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  reasonOrHypothesis: event.target.value,
                }))
              }
              placeholder="CPO had been above target for nine days and Search was capped by budget."
              rows={2}
              value={form.reasonOrHypothesis}
            />
            {fieldErrors.reasonOrHypothesis && (
              <em className="field__error" id="worklog-reasonOrHypothesis-error">
                {fieldErrors.reasonOrHypothesis}
              </em>
            )}
          </label>

          <div className="filter-actions">
            <button
              className="button button--primary"
              disabled={isSaving || !canWrite}
              aria-busy={isSaving}
              title={
                canWrite
                  ? undefined
                  : "Your role does not include worklog:write. Ask an admin for access."
              }
              type="submit"
            >
              {isSaving
                ? "Saving…"
                : canWrite
                  ? "Save entry"
                  : "View-only access"}
            </button>
          </div>
        </form>
      </section>

      <section className="section" id="worklog-entries">
        <div className="section-heading section-heading--worklog section-heading--worklog-table">
          <div className="worklog-section-copy">
            <h2>
              {entries.length} {entries.length === 1 ? "entry" : "entries"} for this
              brand
            </h2>
            <p>Review the context before publishing it to the Paid Ads overview.</p>
          </div>
          <div className="worklog-status-legend" aria-label="Worklog status legend">
            <span>
              <i
                aria-hidden="true"
                className="worklog-status-dot worklog-status-dot--needs-review"
              />
              Needs review stays on this page
            </span>
            <span>
              <i
                aria-hidden="true"
                className="worklog-status-dot worklog-status-dot--approved"
              />
              Approved appears on the overview
            </span>
          </div>
        </div>

        {entries.length === 0 ? (
          <div className="empty-state worklog-empty-state">
            <strong>Nothing logged for this brand yet.</strong>
            <span>Log your first action or review a sample platform change.</span>
            <div>
              <a className="button button--primary" href="#worklog-form">
                Log an action
              </a>
              <a className="button button--secondary" href="#change-history-importer">
                Review samples
              </a>
            </div>
          </div>
        ) : (
          <div className="table-scroller">
            <table>
              <caption className="visually-hidden">
                Worklog entries and their publication status
              </caption>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Platform</th>
                  <th>Applies to</th>
                  <th>Action</th>
                  <th>Status</th>
                  <th>Review</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <th scope="row">{entry.occurredOn}</th>
                    <td>
                      <span
                        className={`worklog-stream-badge worklog-stream-badge--${entry.platform}`}
                      >
                        <WorklogPlatformIcon
                          platform={entry.platform}
                          width={13}
                          height={13}
                        />
                        <span>{formatPlatformLabel(entry.platform)}</span>
                      </span>
                    </td>
                    <td>
                      {formatScopeLabel(entry.scope)}: {entry.entityName}
                    </td>
                    <td>
                      <strong>{entry.actionType}</strong>
                      <br />
                      {entry.actionSummary}
                    </td>
                    <td>
                      <span
                        aria-label={`Status: ${
                          entry.status === "approved" ? "Approved" : "Needs review"
                        }`}
                        className={`worklog-status-chip worklog-status-chip--${entry.status}`}
                      >
                        {entry.status === "approved" ? "Approved" : "Needs review"}
                      </span>
                    </td>
                    <td>
                      {entry.status === "approved" ? (
                        <span className="worklog-review-complete">Complete</span>
                      ) : (
                        <button
                          className="button button--secondary"
                          disabled={
                            isSaving || Boolean(queuedApproval) || !canApprove
                          }
                          onClick={(event) =>
                            requestPublish(entry, event.currentTarget)
                          }
                          title={
                            canApprove
                              ? undefined
                              : "Your role does not include summary:review. Ask an admin for access."
                          }
                          type="button"
                        >
                          {canApprove ? "Publish" : "Admin approval required"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <dialog
        aria-describedby="worklog-publish-description"
        aria-labelledby="worklog-publish-title"
        className="worklog-publish-dialog"
        onCancel={() => setPendingApproval(null)}
        onClose={() => {
          setPendingApproval(null);
          approvalTriggerRef.current?.focus();
        }}
        ref={approvalDialogRef}
      >
        {pendingApproval && (
          <div className="worklog-publish-dialog__content">
            <div>
              <h2 id="worklog-publish-title">Publish this entry to the overview?</h2>
              <p id="worklog-publish-description">
                Published entries can explain movements on the Paid Ads overview.
              </p>
            </div>
            <dl className="worklog-publish-summary">
              <div>
                <dt>Date</dt>
                <dd>{pendingApproval.occurredOn}</dd>
              </div>
              <div>
                <dt>Platform</dt>
                <dd>{formatPlatformLabel(pendingApproval.platform)}</dd>
              </div>
              <div>
                <dt>Action</dt>
                <dd>{pendingApproval.actionType}</dd>
              </div>
              <div className="worklog-publish-summary__wide">
                <dt>Entry</dt>
                <dd>
                  <strong>{pendingApproval.entityName}</strong>
                  <span>{pendingApproval.actionSummary}</span>
                </dd>
              </div>
            </dl>
            <p className="worklog-publish-dialog__note">
              You will have five seconds to undo before publication is committed.
            </p>
            <div className="worklog-publish-dialog__actions">
              <button
                autoFocus
                className="button button--secondary"
                onClick={() => setPendingApproval(null)}
                type="button"
              >
                Cancel
              </button>
              <button
                aria-busy={isSaving}
                className="button button--primary"
                disabled={isSaving}
                onClick={queuePublish}
                type="button"
              >
                Publish entry
              </button>
            </div>
          </div>
        )}
      </dialog>

      {queuedApproval && (
        <div
          aria-atomic="true"
          aria-live="polite"
          className="worklog-undo-toast"
          role="status"
        >
          <div>
            <strong>Publishing to the overview</strong>
            <span>“{queuedApproval.entityName}” will publish in five seconds.</span>
          </div>
          <button type="button" onClick={undoQueuedPublish}>
            Undo
          </button>
          <span className="worklog-undo-toast__timer" aria-hidden="true" />
        </div>
      )}
    </AppFrame>
  );
}
