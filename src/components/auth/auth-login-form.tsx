"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface AuthLoginFormProps {
  mode: "preview" | "supabase";
  ready: boolean;
}

export function AuthLoginForm({ mode, ready }: AuthLoginFormProps) {
  const router = useRouter();
  const [authMethod, setAuthMethod] = useState<"password" | "magic-link">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  // Magic link sent state and countdown timer
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [resendCountdown, setResendCountdown] = useState(0);

  useEffect(() => {
    if (resendCountdown <= 0) return;
    const timer = setInterval(() => {
      setResendCountdown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCountdown]);

  // Handle Google OAuth Sign In
  async function handleGoogleSignIn() {
    setIsGoogleSubmitting(true);
    setStatusMessage(null);
    setIsError(false);

    if (mode === "preview" || !ready) {
      setTimeout(() => {
        setStatusMessage("Preview mode active — redirecting to dashboard…");
        router.push("/");
      }, 600);
      return;
    }

    try {
      const supabase = createClient();
      const redirectTo = `${window.location.origin}/auth/callback?next=/`;
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo,
          queryParams: {
            access_type: "offline",
            prompt: "consent",
          },
        },
      });

      if (error) {
        throw new Error(error.message);
      }
    } catch (err) {
      setIsError(true);
      setStatusMessage(
        err instanceof Error ? err.message : "Failed to authenticate with Google.",
      );
      setIsGoogleSubmitting(false);
    }
  }

  // Handle Password Sign In
  async function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setStatusMessage(null);
    setIsError(false);

    if (mode === "preview" || !ready) {
      setTimeout(() => {
        setStatusMessage("Preview mode active — redirecting to dashboard…");
        router.push("/");
      }, 500);
      return;
    }

    try {
      const response = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, rememberMe }),
      });

      const data = (await response.json()) as { error?: string; ok?: boolean; message?: string };

      if (!response.ok || !data.ok) {
        throw new Error(data.error ?? "Invalid credentials. Please verify your email and password.");
      }

      setStatusMessage("Sign in successful. Redirecting…");
      router.push("/");
      router.refresh();
    } catch (err) {
      setIsError(true);
      setStatusMessage(
        err instanceof Error ? err.message : "Unable to sign in. Please try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  // Handle Magic Link Request
  async function handleMagicLinkSubmit(event?: FormEvent<HTMLFormElement>) {
    if (event) event.preventDefault();
    if (!email || isSubmitting) return;

    setIsSubmitting(true);
    setStatusMessage(null);
    setIsError(false);

    if (mode === "preview" || !ready) {
      setTimeout(() => {
        setMagicLinkSent(true);
        setResendCountdown(30);
        setIsSubmitting(false);
      }, 500);
      return;
    }

    try {
      const response = await fetch("/api/auth/magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = (await response.json()) as { error?: string; message?: string };

      if (!response.ok) {
        throw new Error(data.error ?? "Unable to request a sign-in link.");
      }

      setMagicLinkSent(true);
      setResendCountdown(30);
    } catch (err) {
      setIsError(true);
      setStatusMessage(
        err instanceof Error ? err.message : "Unable to request sign-in link.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="auth-form-wrapper">
      {/* Password vs Magic Link method tabs */}
      <div className="auth-tabs" role="tablist" aria-label="Sign-in method">
        <button
          id="auth-tab-password"
          type="button"
          role="tab"
          aria-selected={authMethod === "password"}
          aria-controls="auth-password-form"
          className={`auth-tab ${authMethod === "password" ? "auth-tab--active" : ""}`}
          onClick={() => {
            setAuthMethod("password");
            setStatusMessage(null);
            setIsError(false);
            setMagicLinkSent(false);
          }}
        >
          <svg className="auth-tab__icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <span>Password</span>
        </button>
        <button
          id="auth-tab-magic-link"
          type="button"
          role="tab"
          aria-selected={authMethod === "magic-link"}
          aria-controls="auth-magic-link-form"
          className={`auth-tab ${authMethod === "magic-link" ? "auth-tab--active" : ""}`}
          onClick={() => {
            setAuthMethod("magic-link");
            setStatusMessage(null);
            setIsError(false);
          }}
        >
          <svg className="auth-tab__icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
          <span>Magic link</span>
        </button>
      </div>

      {authMethod === "password" ? (
        <form id="auth-password-form" className="auth-form" onSubmit={handlePasswordSubmit}>
          <label className="field">
            <span className="field__label">Work email</span>
            <div className="field__input-group">
              <span className="field__prefix-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                  <polyline points="22,6 12,13 2,6" />
                </svg>
              </span>
              <input
                autoComplete="email"
                inputMode="email"
                maxLength={254}
                name="email"
                placeholder="name@company.com"
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="field__input field__input--with-prefix"
              />
            </div>
          </label>

          <label className="field">
            <span className="field__label">Password</span>
            <div className="field__input-group">
              <span className="field__prefix-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              </span>
              <input
                autoComplete="current-password"
                name="password"
                placeholder="••••••••••••"
                required
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="field__input field__input--with-prefix"
              />
              <button
                type="button"
                className="field__toggle-visibility"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? (
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
          </label>

          <div className="auth-form__controls">
            <label className="auth-checkbox">
              <input
                type="checkbox"
                name="rememberMe"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
              />
              <span>Remember me</span>
            </label>

            <button
              type="button"
              className="auth-link-button"
              onClick={() => {
                setAuthMethod("magic-link");
                setStatusMessage(null);
                setIsError(false);
              }}
            >
              Forgot password?
            </button>
          </div>

          <button
            className="button button--primary auth-btn-primary"
            disabled={isSubmitting || isGoogleSubmitting}
            type="submit"
          >
            {isSubmitting ? (
              <span className="auth-btn-spinner-wrap">
                <span className="auth-spinner" aria-hidden="true" />
                <span>Signing in…</span>
              </span>
            ) : (
              "Sign in"
            )}
          </button>
        </form>
      ) : magicLinkSent ? (
        /* Magic Link Sent State Card */
        <div className="auth-magic-success">
          <div className="auth-magic-success__icon-box" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 13V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v12c0 1.1.9 2 2 2h9" />
              <polyline points="22,6 12,13 2,6" />
              <polyline points="16 19 19 22 23 18" />
            </svg>
          </div>

          <div className="auth-magic-success__body">
            <h3>Check your email</h3>
            <div className="auth-magic-success__email-pill">
              <strong>{email}</strong>
            </div>
            <p className="auth-magic-success__hint">
              Use the link we sent to sign in.
            </p>
          </div>

          <div className="auth-magic-success__actions">
            <button
              type="button"
              className="button button--secondary auth-magic-success__resend-btn"
              disabled={resendCountdown > 0 || isSubmitting}
              onClick={() => handleMagicLinkSubmit()}
            >
              {isSubmitting ? (
                <span>Sending link…</span>
              ) : resendCountdown > 0 ? (
                <span>Resend link ({resendCountdown}s)</span>
              ) : (
                <span>Resend email link</span>
              )}
            </button>

            <button
              type="button"
              className="auth-link-button auth-magic-success__back-btn"
              onClick={() => {
                setMagicLinkSent(false);
                setStatusMessage(null);
              }}
            >
              ← Use a different email
            </button>
          </div>

        </div>
      ) : (
        /* Magic Link Input Form */
        <form id="auth-magic-link-form" className="auth-form" onSubmit={handleMagicLinkSubmit}>
          <label className="field">
            <span className="field__label">Work email</span>
            <div className="field__input-group">
              <span className="field__prefix-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                  <polyline points="22,6 12,13 2,6" />
                </svg>
              </span>
              <input
                autoComplete="email"
                inputMode="email"
                maxLength={254}
                name="email"
                placeholder="name@company.com"
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="field__input field__input--with-prefix"
              />
            </div>
          </label>

          <button
            className="button button--primary auth-btn-primary"
            disabled={isSubmitting || isGoogleSubmitting}
            type="submit"
          >
            {isSubmitting ? (
              <span className="auth-btn-spinner-wrap">
                <span className="auth-spinner" aria-hidden="true" />
                <span>Sending link…</span>
              </span>
            ) : (
              <span className="auth-btn-content">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
                <span>Send sign-in link</span>
              </span>
            )}
          </button>
        </form>
      )}

      <button
        type="button"
        className="button auth-btn-google"
        onClick={handleGoogleSignIn}
        disabled={isSubmitting || isGoogleSubmitting}
        aria-label="Sign in with Google Workspace"
      >
        {isGoogleSubmitting ? (
          <span className="auth-btn-spinner-wrap">
            <span className="auth-spinner" aria-hidden="true" />
            <span>Connecting to Google…</span>
          </span>
        ) : (
          <>
            <svg
              className="auth-btn-google__icon"
              viewBox="0 0 24 24"
              width="18"
              height="18"
              aria-hidden="true"
            >
              <path
                fill="#4285F4"
                d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z"
              />
              <path
                fill="#34A853"
                d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.34 24 12 24z"
              />
              <path
                fill="#FBBC05"
                d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.42l4.03-3.15z"
              />
              <path
                fill="#EA4335"
                d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.34 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
              />
            </svg>
            <span>Continue with Google</span>
          </>
        )}
      </button>

      {/* Dynamic Status / Feedback Message */}
      {statusMessage && (
        <div
          aria-live="polite"
          className={`auth-status-message ${isError ? "auth-status-message--error" : "auth-status-message--info"}`}
        >
          {statusMessage}
        </div>
      )}

    </div>
  );
}
