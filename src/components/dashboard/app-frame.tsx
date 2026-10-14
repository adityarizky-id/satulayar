"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useState, type ReactNode } from "react";

import { DashboardSidebar } from "@/components/dashboard/sidebar-nav";
import { ThemeToggle } from "@/components/dashboard/theme-toggle";
import { MenuIcon } from "@/components/dashboard/icons";
import type { DashboardViewer } from "@/lib/auth/types";
import type { Platform } from "@/lib/dashboard/types";
import { BrandMark } from "@/components/dashboard/brand-mark";

/**
 * Shared chrome: sidebar, top bar, and content column. Pages differ in what
 * they show, not in how they are framed, so the frame lives in one place.
 */
export function AppFrame({
  activeHref,
  brandHref = "/",
  viewer,
  platform,
  topbar,
  gateLabel = "Preview data",
  gateNote = "Session and client roles are enforced. Connectors remain mock.",
  sidebarExtra,
  footerBar,
  skipLinkLabel = "Skip to content",
  loading = false,
  children,
}: {
  activeHref: string;
  /** Where the sidebar and mobile brand marks point; the home route uses an
   * in-page anchor instead of a real navigation. */
  brandHref?: string;
  viewer: DashboardViewer;
  /** Hides platform-only nav anchors when the page is scoped to one platform. */
  platform?: Platform;
  topbar?: ReactNode;
  gateLabel?: string;
  gateNote?: string;
  /** Extra sidebar content rendered after the preview-card, e.g. a page-local link. */
  sidebarExtra?: ReactNode;
  /** Optional full-width rail rendered after the page content, outside its inset. */
  footerBar?: ReactNode;
  skipLinkLabel?: string;
  /** Dims the content column in place while a filter/account/platform change refetches. */
  loading?: boolean;
  children: ReactNode;
}) {
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  // Stable, so the drawer's focus effect runs once per open, not per render.
  const closeMobileNav = useCallback(() => setIsMobileNavOpen(false), []);
  const pathname = usePathname();
  const [lastPathname, setLastPathname] = useState(pathname);

  // Adjusting state during render (not in an effect) on a prop change is the
  // pattern React recommends for this; it belt-and-braces each nav link's own
  // onClick by also covering back/forward navigation.
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    setIsMobileNavOpen(false);
  }

  return (
    <div className="app-frame">
      <a className="skip-link" href="#main-content">{skipLinkLabel}</a>

      <DashboardSidebar
        activeHref={activeHref}
        brandHref={brandHref}
        mobileOpen={isMobileNavOpen}
        onMobileClose={closeMobileNav}
        platform={platform}
      >
        <div className="preview-card">
          <span className="eyebrow">Current gate</span>
          <strong>{gateLabel}</strong>
          {gateNote && <p>{gateNote}</p>}
        </div>
        {sidebarExtra}
      </DashboardSidebar>

      <main className="main-panel" id="main-content">
        <header className="topbar">
          <button
            aria-controls="dashboard-primary-navigation"
            aria-expanded={isMobileNavOpen}
            aria-label="Open navigation"
            className="mobile-nav-toggle"
            onClick={() => setIsMobileNavOpen(true)}
            type="button"
          >
            <MenuIcon />
          </button>
          <Link className="mobile-brand" href={brandHref} aria-label="Satulayar dashboard">
            <BrandMark />
            <strong>Satulayar</strong>
          </Link>
          {topbar}
          <div aria-label="Display and account controls" className="topbar__session">
            <ThemeToggle />
            <div className="viewer-menu">
              <span className="viewer-menu__identity">
                <small>
                  {viewer.mode === "preview"
                    ? "Local preview"
                    : viewer.email ?? "Signed in"}
                </small>
                <strong>{viewer.role.replace("_", " ")}</strong>
              </span>
              <form action="/api/auth/sign-out" method="post">
                <button className="viewer-menu__signout" type="submit">
                  Sign out
                </button>
              </form>
            </div>
          </div>
        </header>

        <div
          aria-busy={loading}
          className={`content${loading ? " content--loading" : ""}`}
        >
          {children}
        </div>
        {footerBar}
      </main>
    </div>
  );
}
