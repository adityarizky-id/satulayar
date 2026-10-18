"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { validatePlatformCredentials, type DirectConnectorPlatform } from "@/lib/connectors/types";
import type { DataSourceCard } from "@/components/dashboard/connector-console";
import { GoogleAdsIcon, Ga4Icon, MetaAdsIcon } from "@/components/dashboard/icons";
import { BrandGlyph } from "@/components/dashboard/brand-mark";

/** The non-secret summary `/api/connectors/credentials` returns on success. */
export interface SavedCredentialsResult {
  platform: string;
  clientSlug: string;
  targetAccount: string;
  savedAt: string;
  verification: string;
  auditRecorded: boolean;
  message: string;
  expiresAt?: string | null;
}

export type CredentialFieldName =
  | "customerId"
  | "developerToken"
  | "clientId"
  | "clientSecret"
  | "refreshToken"
  | "loginCustomerId"
  | "accessToken"
  | "apiVersion"
  | "tokenExpiresAt"
  | "campaignNameFilter"
  | "propertyId";

interface CredentialFieldSpec {
  name: CredentialFieldName;
  label: string;
  type: "text" | "password" | "date";
  placeholder?: string;
  helper?: string;
  required: boolean;
}

export const GOOGLE_ADS_CREDENTIAL_FIELDS: readonly CredentialFieldSpec[] = [
  {
    name: "customerId",
    label: "Google Ads Customer ID",
    type: "text",
    placeholder: "123-450-0001",
    helper: "10-digit account ID",
    required: true,
  },
  {
    name: "developerToken",
    label: "Developer Token",
    type: "password",
    placeholder: "••••••••••••",
    helper: "Google Ads Manager API token",
    required: true,
  },
  {
    name: "clientId",
    label: "Client ID",
    type: "text",
    placeholder: "...apps.googleusercontent.com",
    required: true,
  },
  {
    name: "clientSecret",
    label: "Client Secret",
    type: "password",
    required: true,
  },
  {
    name: "refreshToken",
    label: "Refresh Token",
    type: "password",
    helper: "OAuth 2.0 refresh token with AdWords scope",
    required: true,
  },
  {
    name: "loginCustomerId",
    label: "Manager / MCC Customer ID (Optional)",
    type: "text",
    placeholder: "123-456-7890",
    required: false,
  },
];

export const PLATFORM_CREDENTIAL_FIELDS: Record<DirectConnectorPlatform, readonly CredentialFieldSpec[]> = {
  "google-ads": GOOGLE_ADS_CREDENTIAL_FIELDS,
  "meta-ads": [
    { name: "customerId", label: "Meta ad account ID", type: "text", placeholder: "act_123456789012345", required: true },
    { name: "accessToken", label: "Long-lived access token", type: "password", helper: "Generate a token with ads_read and read_insights for this account in Meta Business Settings or your Meta app. It is never returned after saving.", required: true },
    { name: "apiVersion", label: "Graph API version", type: "text", placeholder: "vNN.N", helper: "Copy the supported version from your Meta app dashboard.", required: true },
    { name: "tokenExpiresAt", label: "Token expiry date", type: "date", helper: "Choose the expiry date shown by Meta. Renew before this date; dates use your device's timezone.", required: true },
    { name: "campaignNameFilter", label: "Campaign name contains (optional)", type: "text", helper: "Use a unique brand label for shared ad accounts. Empty includes every campaign and is allowed only for a dedicated account.", required: false },
  ],
  "google-analytics": [
    { name: "propertyId", label: "GA4 property ID", type: "text", helper: "Numeric ID in Analytics → Admin → Property details; not a G- measurement ID.", required: true },
    { name: "clientId", label: "OAuth client ID", type: "text", required: true },
    { name: "clientSecret", label: "OAuth client secret", type: "password", required: true },
    { name: "refreshToken", label: "Refresh token", type: "password", helper: "Authorize analytics.readonly with a user who can read this property. Enable the Analytics Data API in the same Google Cloud project.", required: true },
  ],
};

const PLATFORM_NAMES: Record<DirectConnectorPlatform, string> = {
  "google-ads": "Google Ads", "meta-ads": "Meta Ads", "google-analytics": "Google Analytics 4",
};

type CredentialValues = Record<"customerId" | "developerToken" | "clientId" | "clientSecret" | "refreshToken" | "loginCustomerId", string> & Partial<Record<CredentialFieldName, string>>;

const EMPTY_VALUES: CredentialValues = {
  customerId: "",
  developerToken: "",
  clientId: "",
  clientSecret: "",
  refreshToken: "",
  loginCustomerId: "",
  accessToken: "", apiVersion: "", tokenExpiresAt: "", campaignNameFilter: "", propertyId: "",
};

const TEN_DIGITS = /^\d{10}$/;

/** Date-only entry uses the start of the local day, so it never overstates token life. */
export function metaExpiryDateToIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00`);
  if (!Number.isFinite(date.getTime())) return null;
  const localDate = `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return localDate === value ? date.toISOString() : null;
}

function firstSelectableExpiryDate(): string {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
}

/**
 * The checks worth making before a round trip: required fields and the two
 * account-id formats. The server repeats all of them and more, and its answer
 * is the one that counts.
 */
export function validateCredentialForm(
  values: CredentialValues,
  platform: DirectConnectorPlatform = "google-ads",
): { field: CredentialFieldName; message: string } | null {
  for (const field of PLATFORM_CREDENTIAL_FIELDS[platform]) {
    if (field.required && !values[field.name]?.trim()) {
      return { field: field.name, message: `${field.label} is required.` };
    }
  }
  const expiry = platform === "meta-ads" ? metaExpiryDateToIso(values.tokenExpiresAt ?? "") : null;
  if (platform === "meta-ads" && (!expiry || Date.parse(expiry) <= Date.now())) {
    return { field: "tokenExpiresAt", message: "Choose a future expiry date. If the token expires today, renew it before connecting." };
  }
  const invalid = validatePlatformCredentials(platform, platform === "meta-ads" ? { ...values, tokenExpiresAt: expiry } : values);
  if (invalid) return { field: invalid.field as CredentialFieldName, message: invalid.message };
  if (platform !== "google-ads") return null;

  if (!TEN_DIGITS.test(values.customerId.replace(/[\s-]/g, ""))) {
    return {
      field: "customerId",
      message: "Google Ads Customer ID must be a 10-digit account ID, for example 123-450-0001.",
    };
  }

  const login = values.loginCustomerId.trim();
  if (login && !TEN_DIGITS.test(login.replace(/[\s-]/g, ""))) {
    return {
      field: "loginCustomerId",
      message: "Manager / MCC Customer ID must be a 10-digit account ID, or left empty.",
    };
  }

  return null;
}

function isCredentialField(value: unknown): value is CredentialFieldName {
  return Object.values(PLATFORM_CREDENTIAL_FIELDS).flat().some((field) => field.name === value);
}

type ConnectionStage = "form" | "preparing" | "authorizing" | "verifying" | "success" | "error";

/** Shared status surface for every active connector, regardless of its auth method. */
export function ConnectorConnectionProgress({ platform, stage, error, onRetry, onClose, onFocusProvider }: {
  platform: DirectConnectorPlatform; stage: Exclude<ConnectionStage, "form">;
  error?: string; onRetry: () => void; onClose: () => void; onFocusProvider?: () => void;
}) {
  const Icon = platform === "meta-ads" ? MetaAdsIcon : platform === "google-analytics" ? Ga4Icon : GoogleAdsIcon;
  const title = stage === "success" ? "Connected successfully" : stage === "error" ? "Connection not completed" : stage === "authorizing" ? "Approve access in Google" : stage === "preparing" ? "Opening secure connection" : "Verifying your connection";
  return <section className={`connector-progress connector-progress--${stage}`} aria-live="polite" aria-atomic="true" aria-busy={stage !== "success" && stage !== "error"}>
    <div className="connector-progress__identity"><span className="connector-progress__brand"><BrandGlyph /></span><span aria-hidden="true">↔</span><span className="connector-progress__provider"><Icon /></span></div>
    <span className="eyebrow">Satulayar + {PLATFORM_NAMES[platform]}</span>
    <div className="connector-progress__indicator" aria-hidden="true">{stage === "success" ? "✓" : stage === "error" ? "!" : <span className="connector-progress__spinner" />}</div>
    <h3>{title}</h3>
    <p>{stage === "success" ? "Reporting access was verified and saved for this brand. This popup will close automatically." : stage === "error" ? error : stage === "authorizing" ? "Choose your Google account and approve the requested reporting permission in the Google window. Then return here; we will confirm the connection automatically." : "Keep this screen open while we check platform access and securely save the connection. Live reporting follows your workspace settings."}</p>
    <ol className="connector-progress__steps" aria-label="Connection steps">
      <li data-complete={stage !== "preparing" && stage !== "error"}>1 · {platform === "meta-ads" ? "Check credentials" : "Authorize access"}</li>
      <li data-complete={stage === "success"}>2 · Verify reporting</li>
      <li data-complete={stage === "success"}>3 · Save connection</li>
    </ol>
    <div className="credential-dialog__actions">
      {stage === "authorizing" && onFocusProvider && <button className="console-button console-button--quiet" type="button" onClick={onFocusProvider}>Show Google window</button>}
      {stage === "error" && <button className="console-button console-button--primary" type="button" onClick={onRetry}>Try again</button>}
      <button className="console-button console-button--quiet" type="button" onClick={onClose}>{stage === "success" || stage === "error" ? "Close" : "Stop waiting"}</button>
    </div>
  </section>;
}

/**
 * Collects the selected platform's credential set for the brand in view and
 * hands it to the server, which verifies reporting access before storing it.
 *
 * Secrets live in this component's state only while the dialog is open: they
 * are cleared on save, on cancel, and on Escape, and nothing already stored is
 * ever read back into the form. Editing a connection therefore means entering
 * the set again — the price of a form that cannot leak what it never receives.
 */
export function ConnectorCredentialsModal({
  accountName,
  clientSlug,
  open,
  platform = "google-ads",
  setup,
  onClose,
  onSaved,
}: {
  accountName: string;
  clientSlug: string;
  open: boolean;
  platform?: DirectConnectorPlatform;
  setup?: DataSourceCard["setup"];
  onClose: () => void;
  onSaved: (result: SavedCredentialsResult) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const formId = useId();
  const [values, setValues] = useState<CredentialValues>(EMPTY_VALUES);
  const [isSaving, setIsSaving] = useState(false);
  const [stage, setStage] = useState<ConnectionStage>("form");
  const [manualGoogle, setManualGoogle] = useState(false);
  const popupRef = useRef<Window | null>(null);
  const operationRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedRef = useRef<SavedCredentialsResult | null>(null);
  const googleConsent = platform !== "meta-ads" && !manualGoogle;
  const [error, setError] = useState<{
    field: CredentialFieldName | null;
    message: string;
  } | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    // The parent keys the dialog by connector, so closing replaces the node.
    // Close before unmount and restore the actual trigger rather than the body.
    return () => {
      if (dialog.open) dialog.close();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open]);

  useEffect(() => () => {
    operationRef.current += 1;
    if (timerRef.current) clearTimeout(timerRef.current);
    popupRef.current?.close();
  }, []);

  function reset() {
    setValues(EMPTY_VALUES);
    setError(null);
  }

  function closeConnection() {
    // A request already accepted by the server may still finish. Never claim
    // that closing a local window revokes or cancels a grant.
    operationRef.current += 1;
    if (timerRef.current) clearTimeout(timerRef.current);
    popupRef.current?.close();
    const saved = savedRef.current;
    reset();
    if (saved) onSaved(saved);
    else onClose();
  }

  function connected(result: SavedCredentialsResult) {
    reset();
    savedRef.current = result;
    setIsSaving(false);
    setStage("success");
    timerRef.current = setTimeout(() => onSaved(result), 1800);
  }

  async function startGoogleConsent() {
    if (isSaving) return;
    const operation = ++operationRef.current;
    // Open synchronously from the user's click so browser popup protection
    // does not mistake the later fetch response for an unsolicited window.
    const popup = window.open("about:blank", `satulayar-${platform}-${Date.now()}`, "popup,width=600,height=760");
    if (!popup) {
      setError({ field: null, message: "Your browser blocked the Google window. Allow popups for this site and try again." });
      setStage("error");
      return;
    }
    popupRef.current = popup;
    setIsSaving(true);
    setError(null);
    setStage("preparing");
    try {
      const response = await fetch(`/api/connectors/oauth/${platform}/authorize`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientSlug, ...values }),
        signal: AbortSignal.timeout(15_000),
      });
      const body = await response.json();
      if (operation !== operationRef.current) return;
      if (!response.ok || !body.ok) {
        popup.close();
        setError({ field: isCredentialField(body.field) ? body.field : null, message: body.error ?? "Google authorization could not start." });
        setStage("form");
        setIsSaving(false);
        if (isCredentialField(body.field)) window.requestAnimationFrame(() => focusField(body.field));
        return;
      }
      const authorizationUrl = new URL(body.authorizationUrl);
      if (authorizationUrl.origin !== "https://accounts.google.com") throw new Error("Unexpected provider");
      popup.location.replace(authorizationUrl.toString());
      setStage("authorizing");
      const deadline = Date.now() + 900_000;
      // Poll a signed, httpOnly result. This also works when Google's COOP
      // policy severs window.opener; neither postMessage nor window.closed is
      // trusted as proof of a successful connection.
      const poll = async () => {
        if (operation !== operationRef.current) return;
        try {
          const result = await fetch(`/api/connectors/oauth/${platform}/callback?connection_result=${encodeURIComponent(body.attempt)}&client=${encodeURIComponent(clientSlug)}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
          const summary = await result.json();
          if (operation !== operationRef.current) return;
          if (result.status !== 202) {
            if (!result.ok || !summary.ok) {
              setError({ field: null, message: summary.error ?? "Google did not complete the connection. Try again." });
              setIsSaving(false); setStage("error"); return;
            }
            if (summary.platform !== platform || summary.clientSlug !== clientSlug) throw new Error("Wrong connection");
            connected(summary as SavedCredentialsResult);
            return;
          }
          if (Date.now() >= deadline) throw new Error("Expired");
          timerRef.current = setTimeout(poll, 1000);
        } catch {
          if (operation !== operationRef.current) return;
          setError({ field: null, message: "The connection result could not be confirmed. Reopen Data sources to check the current state before retrying." });
          setIsSaving(false); setStage("error");
        }
      };
      timerRef.current = setTimeout(poll, 800);
    } catch {
      if (operation !== operationRef.current) return;
      popup.close();
      setError({ field: null, message: "The secure Google connection could not start. Check your network and try again." });
      setIsSaving(false); setStage("error");
    }
  }

  function focusField(field: CredentialFieldName | null) {
    if (!field) return;
    dialogRef.current
      ?.querySelector<HTMLInputElement>(`[name="${field}"]`)
      ?.focus();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSaving) return;
    if (googleConsent) { await startGoogleConsent(); return; }

    const invalid = validateCredentialForm(values, platform);
    if (invalid) {
      setError(invalid);
      focusField(invalid.field);
      return;
    }

    setIsSaving(true);
    setError(null);
    setStage("verifying");
    const operation = ++operationRef.current;
    try {
      const response = await fetch("/api/connectors/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform, clientSlug, ...values, ...(platform === "meta-ads" ? { tokenExpiresAt: metaExpiryDateToIso(values.tokenExpiresAt ?? "") } : {}) }),
      });
      const body = (await response.json().catch(() => ({}))) as Partial<
        SavedCredentialsResult & { ok: boolean; error: string; field: string }
      >;
      if (operation !== operationRef.current) return;

      if (!response.ok || !body.ok) {
        const field = isCredentialField(body.field) ? body.field : null;
        setError({
          field,
          message: body.error ?? "The credentials could not be saved. Nothing was changed.",
        });
        setStage("form");
        window.requestAnimationFrame(() => focusField(field));
        return;
      }

      connected(body as SavedCredentialsResult);
    } catch {
      if (operation !== operationRef.current) return;
      setError({
        field: null,
        message: "The save result could not be confirmed. Reopen Data sources to check the current connection before retrying.",
      });
      setStage("error");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <dialog
      aria-describedby={`${formId}-description`}
      aria-labelledby={`${formId}-title`}
      className="credential-dialog"
      onCancel={(event) => {
        event.preventDefault();
        closeConnection();
      }}
      ref={dialogRef}
    >
      {open && stage !== "form" && <div className="credential-dialog__content">
        <header className="credential-dialog__header"><h2 id={`${formId}-title`}>Connect {PLATFORM_NAMES[platform]}</h2><p id={`${formId}-description`}>For <strong>{accountName}</strong>. Closing this screen stops waiting; a submitted authorization may still finish.</p></header>
        <ConnectorConnectionProgress platform={platform} stage={stage} error={error?.message} onClose={closeConnection} onRetry={() => { popupRef.current?.close(); setStage("form"); setIsSaving(false); }} onFocusProvider={() => popupRef.current?.focus()} />
      </div>}
      {open && stage === "form" && (
        <form
          autoComplete="off"
          data-form-type="other"
          className="credential-dialog__content"
          noValidate
          onSubmit={handleSubmit}
        >
          <header className="credential-dialog__header">
            <h2 id={`${formId}-title`}>Configure {PLATFORM_NAMES[platform]}</h2>
            <p id={`${formId}-description`}>
              For <strong>{accountName}</strong>. Stored server-side for this brand
              only and never shown again after saving.
            </p>
          </header>

          {platform !== "meta-ads" && <div className="credential-dialog__auth-choice">
            <p>{googleConsent ? "Choose your account and approve access securely with Google. Your refresh token is received automatically." : "Use an existing API grant instead of opening Google consent."}</p>
            {googleConsent && platform === "google-ads" && <p>Google Ads uses Google’s standard ads permission. Satulayar only reads reporting data.</p>}
            <button type="button" className="console-button console-button--quiet" onClick={() => { setManualGoogle(!manualGoogle); setError(null); }}>{googleConsent ? "Use API credentials instead" : "Use Google consent"}</button>
          </div>}

          {setup?.settings.some((setting) => !setting.configured) && (
            <div className="credential-dialog__alert" role="status">
              <p>Secure workspace storage is not ready. Your workspace administrator must finish installation before this connection can be saved.</p>
              <details><summary>Show missing workspace settings</summary><code>{setup.settings.filter((setting) => !setting.configured).map((setting) => setting.name).join(", ")}</code></details>
            </div>
          )}
          <details className="credential-dialog__guide">
            <summary>Where to find these details</summary>
            <ol>{setup?.requirements.map((requirement) => <li key={requirement}>{requirement}</li>)}</ol>
            {setup?.documentationUrl && <a href={setup.documentationUrl} target="_blank" rel="noreferrer">Open provider setup guide ↗</a>}
          </details>

          {(googleConsent ? ["account", "app"] : ["all"]).map((group) => {
            const Group = group === "app" ? "details" : "div";
            return <Group key={group} className={group === "app" ? "credential-dialog__guide" : undefined} {...(group === "app" ? { open: error?.field === "clientId" || error?.field === "clientSecret" ? true : undefined } : {})}>
              {group === "app" && <>
                <summary>{setup?.oauthDefaults?.clientConfigured ? "Advanced · OAuth app settings" : "OAuth app settings · required for first connection"}</summary>
                <p>Reuse the workspace app by leaving both fields empty, or enter your own matching client pair. Register this exact redirect URI in that Google Cloud OAuth web client:</p>
                <code className="connector-setup-dialog__callback">{setup?.callbackUrl ?? `${typeof window === "undefined" ? "" : window.location.origin}/api/connectors/oauth/${platform}/callback`}</code>
              </>}
          <div className="credential-dialog__fields">
            {PLATFORM_CREDENTIAL_FIELDS[platform].filter((field) => !googleConsent || field.name !== "refreshToken" && (group === "app" ? field.name === "clientId" || field.name === "clientSecret" : field.name !== "clientId" && field.name !== "clientSecret")).map((field) => {
              const inputId = `${formId}-${field.name}`;
              const helperId = field.helper ? `${inputId}-helper` : undefined;
              const hasError = error?.field === field.name;
              const errorId = hasError ? `${inputId}-error` : undefined;
              const canReuse = googleConsent && (((field.name === "clientId" || field.name === "clientSecret") && setup?.oauthDefaults?.clientConfigured) || (field.name === "developerToken" && setup?.oauthDefaults?.developerTokenConfigured));
              return (
                <div className="credential-dialog__field" key={field.name}>
                  <label htmlFor={inputId}>{field.label}{canReuse ? " (leave empty to reuse workspace setup)" : ""}</label>
                  <input
                    aria-describedby={
                      [helperId, errorId].filter(Boolean).join(" ") || undefined
                    }
                    aria-invalid={hasError || undefined}
                    aria-required={(field.required && !canReuse) || undefined}
                    autoCapitalize="none"
                    autoComplete={field.type === "password" ? "new-password" : "off"}
                    data-1p-ignore
                    data-lpignore="true"
                    autoCorrect="off"
                    disabled={isSaving}
                    id={inputId}
                    name={field.name}
                    onChange={(event) => {
                      const next = event.target.value;
                      setValues((current) => ({ ...current, [field.name]: next }));
                      if (hasError) setError(null);
                    }}
                    placeholder={field.placeholder}
                    spellCheck={false}
                    maxLength={8192}
                    min={field.type === "date" ? firstSelectableExpiryDate() : undefined}
                    type={field.type}
                    value={values[field.name]}
                  />
                  {field.helper && (
                    <small className="credential-dialog__helper" id={helperId}>
                      {field.helper}
                    </small>
                  )}
                  {hasError && (
                    <small className="credential-dialog__error" id={errorId}>
                      {error.message}
                    </small>
                  )}
                </div>
              );
            })}
          </div>
            </Group>;
          })}

          {error && !error.field && (
            <p className="credential-dialog__alert" role="alert">
              {error.message}
            </p>
          )}

          <p className="credential-dialog__note">
            {PLATFORM_NAMES[platform]} checks these credentials before they are stored. The current
            connection is replaced only if the new set is accepted.
          </p>

          <div className="credential-dialog__actions">
            <button
              className="console-button console-button--quiet"
              disabled={isSaving}
              onClick={() => {
                reset();
                onClose();
              }}
              type="button"
            >
              Cancel
            </button>
            <button
              aria-busy={isSaving}
              className="console-button console-button--primary"
              disabled={isSaving}
              type="submit"
            >
              {isSaving ? "Connecting…" : googleConsent ? "Continue with Google" : "Verify and save"}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
