"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";

/** The non-secret summary `/api/connectors/credentials` returns on success. */
export interface SavedCredentialsResult {
  platform: string;
  clientSlug: string;
  targetAccount: string;
  savedAt: string;
  verification: string;
  auditRecorded: boolean;
  message: string;
}

export type CredentialFieldName =
  | "customerId"
  | "developerToken"
  | "clientId"
  | "clientSecret"
  | "refreshToken"
  | "loginCustomerId";

interface CredentialFieldSpec {
  name: CredentialFieldName;
  label: string;
  type: "text" | "password";
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

type CredentialValues = Record<CredentialFieldName, string>;

const EMPTY_VALUES: CredentialValues = {
  customerId: "",
  developerToken: "",
  clientId: "",
  clientSecret: "",
  refreshToken: "",
  loginCustomerId: "",
};

const TEN_DIGITS = /^\d{10}$/;

/**
 * The checks worth making before a round trip: required fields and the two
 * account-id formats. The server repeats all of them and more, and its answer
 * is the one that counts.
 */
export function validateCredentialForm(
  values: CredentialValues,
): { field: CredentialFieldName; message: string } | null {
  for (const field of GOOGLE_ADS_CREDENTIAL_FIELDS) {
    if (field.required && !values[field.name].trim()) {
      return { field: field.name, message: `${field.label} is required.` };
    }
  }

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
  return GOOGLE_ADS_CREDENTIAL_FIELDS.some((field) => field.name === value);
}

/**
 * Collects a Google Ads credential set for the brand in view and hands it to
 * the server, which verifies it with Google before storing it.
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
  onClose,
  onSaved,
}: {
  accountName: string;
  clientSlug: string;
  open: boolean;
  onClose: () => void;
  onSaved: (result: SavedCredentialsResult) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const formId = useId();
  const [values, setValues] = useState<CredentialValues>(EMPTY_VALUES);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<{
    field: CredentialFieldName | null;
    message: string;
  } | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  function reset() {
    setValues(EMPTY_VALUES);
    setError(null);
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

    const invalid = validateCredentialForm(values);
    if (invalid) {
      setError(invalid);
      focusField(invalid.field);
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/connectors/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform: "google-ads", clientSlug, ...values }),
      });
      const body = (await response.json().catch(() => ({}))) as Partial<
        SavedCredentialsResult & { ok: boolean; error: string; field: string }
      >;

      if (!response.ok || !body.ok) {
        const field = isCredentialField(body.field) ? body.field : null;
        setError({
          field,
          message: body.error ?? "The credentials could not be saved. Nothing was changed.",
        });
        focusField(field);
        return;
      }

      reset();
      onSaved(body as SavedCredentialsResult);
    } catch {
      setError({
        field: null,
        message: "The credentials endpoint could not be reached. Nothing was saved.",
      });
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
        // Escape mid-save would close the dialog on a request still in flight.
        if (isSaving) {
          event.preventDefault();
          return;
        }
        reset();
        onClose();
      }}
      ref={dialogRef}
    >
      {open && (
        <form
          className="credential-dialog__content"
          noValidate
          onSubmit={handleSubmit}
        >
          <header className="credential-dialog__header">
            <h2 id={`${formId}-title`}>Configure Google Ads Credentials</h2>
            <p id={`${formId}-description`}>
              For <strong>{accountName}</strong>. Stored server-side for this brand
              only and never shown again after saving.
            </p>
          </header>

          <div className="credential-dialog__fields">
            {GOOGLE_ADS_CREDENTIAL_FIELDS.map((field) => {
              const inputId = `${formId}-${field.name}`;
              const helperId = field.helper ? `${inputId}-helper` : undefined;
              const hasError = error?.field === field.name;
              const errorId = hasError ? `${inputId}-error` : undefined;
              return (
                <div className="credential-dialog__field" key={field.name}>
                  <label htmlFor={inputId}>{field.label}</label>
                  <input
                    aria-describedby={
                      [helperId, errorId].filter(Boolean).join(" ") || undefined
                    }
                    aria-invalid={hasError || undefined}
                    aria-required={field.required || undefined}
                    autoCapitalize="none"
                    autoComplete="off"
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

          {error && !error.field && (
            <p className="credential-dialog__alert" role="alert">
              {error.message}
            </p>
          )}

          <p className="credential-dialog__note">
            Google Ads checks these credentials before they are stored. The current
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
              {isSaving ? "Saving…" : "Save Credentials"}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
