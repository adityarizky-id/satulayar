import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthStageVisual } from "@/components/auth/auth-stage-visual";
import { AuthLoginForm } from "@/components/auth/auth-login-form";
import { ThemeToggle } from "@/components/dashboard/theme-toggle";
import { PILOT_CLIENT_SLUG } from "@/lib/auth/constants";
import { getAuthConfiguration } from "@/lib/auth/auth-config";
import { resolveAuthContext } from "@/lib/auth/session";
import { BrandMark } from "@/components/dashboard/brand-mark";

export const dynamic = "force-dynamic";

export default async function SignInPage() {
  const configuration = getAuthConfiguration();
  const existingAuth = await resolveAuthContext(PILOT_CLIENT_SLUG);

  // In Supabase mode with an active session, skip the portal straight to dashboard.
  // In preview/review mode, keep the sign-in page accessible.
  if (existingAuth.ok && configuration.mode === "supabase") redirect("/");

  return (
    <main className="auth-page">
      {/* 60% Visual & Telemetry Stage */}
      <AuthStageVisual />

      {/* 40% Authentication Credentials Panel */}
      <section className="auth-panel">
        <div className="auth-card">
          <div className="auth-card__toolbar">
            <Link className="brand auth-card__brand" href="/" aria-label="Satulayar dashboard">
              <BrandMark />
              <strong>Satulayar</strong>
            </Link>
            <ThemeToggle />
          </div>

          <div className="auth-card__intro">
            <h2>Welcome back</h2>
            <p>Sign in to your marketing intelligence workspace.</p>
          </div>

          {configuration.mode === "preview" && (
            <div className="auth-preview-banner">
              <div className="auth-preview-banner__badge">Preview Mode Active</div>
              <Link className="button button--secondary auth-preview-banner__link" href="/">
                Quick Enter Dashboard →
              </Link>
            </div>
          )}

          {configuration.ready || configuration.mode === "preview" ? (
            <AuthLoginForm mode={configuration.mode} ready={configuration.ready} />
          ) : (
            <div className="auth-readiness" role="status">
              <strong>Authentication setup required</strong>
              <p>{configuration.safeMessage}</p>
            </div>
          )}

          <p className="auth-card__boundary">Ad performance, store outcomes, and reviewed actions in one workspace.</p>
        </div>
      </section>
    </main>
  );
}
