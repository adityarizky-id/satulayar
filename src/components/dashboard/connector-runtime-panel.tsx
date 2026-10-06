import { memo } from "react";

// Types only from `health.ts`: a type import is erased at build time, so it
// cannot pull the provider catalog's credential reads into this client bundle.
// The one value this panel needs lives in a credential-free module.
import type {
  ConnectorCredentialStatus,
  ConnectorHealthReport,
} from "@/lib/connectors/health";
import { groupMissingSettings } from "@/lib/connectors/missing-settings";

const MODE_LABELS: Record<ConnectorHealthReport["mode"], string> = {
  live: "Live",
  mock: "Mock (synthetic)",
};

const STORAGE_LABELS: Record<ConnectorHealthReport["storage"], string> = {
  supabase: "Supabase",
  fixture: "Local fixtures",
};

const PLATFORM_LABELS: Record<string, string> = {
  google: "Google",
  meta: "Meta",
};

const CREDENTIAL_LABELS: Record<
  ConnectorCredentialStatus,
  { label: string; tone: string }
> = {
  configured: { label: "Configured", tone: "signal-chip--connected" },
  missing: { label: "Missing", tone: "signal-chip--disconnected" },
  "not-selected": { label: "Not selected", tone: "signal-chip--planned" },
};

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export const ConnectorRuntimePanel = memo(function ConnectorRuntimePanel({
  health,
}: {
  health: ConnectorHealthReport;
}) {
  const missingGroups = groupMissingSettings(health.liveSyncMissing);
  const providerRows = health.platforms.flatMap((platform) =>
    platform.providers.map((provider) => ({ platform, provider })),
  );

  return (
    <section className="connector-runtime" aria-labelledby="runtime-readiness-title">
      <header className="connector-runtime__header">
        <div>
          <h2 id="runtime-readiness-title">Runtime readiness</h2>
          <p>Server-side policy state only. Credential values never reach this screen.</p>
        </div>
        {/*
          A locked gate is a prerequisite not yet met, not a failure: nothing
          broke and nothing was written. It reads as "watch" (amber), and red
          stays reserved for a real error.
        */}
        <span
          className={`signal-chip ${
            health.liveSyncLocked ? "signal-chip--disconnected" : "signal-chip--connected"
          }`}
        >
          <span aria-hidden="true" className="signal-chip__dot" />
          {health.liveSyncLocked ? "Live sync locked" : "Live sync ready"}
        </span>
      </header>

      <dl className="connector-runtime__facts">
        <div>
          <dt>Data mode</dt>
          <dd>{MODE_LABELS[health.mode]}</dd>
        </div>
        <div>
          <dt>Storage</dt>
          <dd>{STORAGE_LABELS[health.storage]}</dd>
        </div>
        <div>
          <dt>Access contract</dt>
          <dd>{health.readOnlyEnforced ? "Read only" : "Unverified"}</dd>
        </div>
        <div>
          <dt>Policy check</dt>
          <dd>
            <time dateTime={health.checkedAt}>
              {new Intl.DateTimeFormat("en-GB", {
                day: "2-digit",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              }).format(new Date(health.checkedAt))}
            </time>
          </dd>
        </div>
      </dl>

      {health.liveSyncLocked && missingGroups.length > 0 ? (
        <div
          aria-labelledby="runtime-gate-title"
          className="connector-runtime__gate connector-runtime__gate--locked"
          role="group"
        >
          <p className="connector-runtime__gate-title" id="runtime-gate-title">
            <strong>
              {plural(health.liveSyncMissing.length, "server setting")} missing
            </strong>
            <span>
              Live sync stays locked until each one is set on the server and the
              app is restarted. Only names are listed.
            </span>
          </p>
          <div className="connector-runtime__gate-groups">
            {missingGroups.map((group) => (
              <div className="connector-runtime__gate-group" key={group.label}>
                <h3>{group.label}</h3>
                <ul>
                  {group.settings.map((setting) => (
                    <li key={setting.key}>
                      <code>{setting.key}</code>
                      {setting.hint && <small>{setting.hint}</small>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="connector-runtime__gate">{health.liveSyncGateReason}</p>
      )}

      <details className="connector-runtime__details">
        <summary>
          Provider order
          <span className="connector-runtime__summary-meta">
            {plural(providerRows.length, "provider")}, in fallback priority
          </span>
        </summary>
        <div className="connector-runtime__table-wrap">
          <table className="connector-runtime__table">
            <thead>
              <tr>
                <th scope="col">Platform</th>
                <th scope="col">Provider</th>
                <th scope="col">Kind</th>
                <th scope="col">Credential</th>
                <th scope="col">Activation</th>
              </tr>
            </thead>
            <tbody>
              {providerRows.map(({ platform, provider }) => {
                const credential = CREDENTIAL_LABELS[provider.credentialStatus];
                return (
                  <tr key={`${platform.platform}-${provider.providerId}`}>
                    <td>{PLATFORM_LABELS[platform.platform] ?? platform.platform}</td>
                    <td>
                      <strong>{provider.providerId}</strong>
                    </td>
                    <td>
                      <code>{provider.providerKind}</code>
                    </td>
                    <td>
                      <span className={`signal-chip ${credential.tone}`}>
                        {credential.label}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`signal-chip ${
                          provider.activation === "active"
                            ? "signal-chip--connected"
                            : "signal-chip--planned"
                        }`}
                      >
                        {provider.activation === "active" ? "Active" : "Locked"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
});
