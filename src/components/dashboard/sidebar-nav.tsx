"use client";

import Link from "next/link";
import {
  useEffect,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type MouseEvent,
  type ReactNode,
  type SVGProps,
} from "react";

import {
  anchorSectionId,
  isSectionVisible,
} from "@/lib/dashboard/sections";
import type { Platform } from "@/lib/dashboard/types";
import {
  AccountIcon,
  ChevronIcon,
  CloseIcon,
  CrmIcon,
  DashboardIcon,
  NoteIcon,
  PlugIcon,
  SearchIcon,
  SidebarToggleIcon,
  SocialIcon,
  StoreIcon,
} from "@/components/dashboard/icons";
import { BrandMark } from "@/components/dashboard/brand-mark";

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

export interface NavChild {
  label: string;
  href: string;
}

export interface NavSection {
  label: string;
  href: string;
  icon: IconComponent;
  /** Channels that are planned but not built yet render as disabled. */
  comingSoon?: boolean;
  children?: NavChild[];
}

export interface NavGroup {
  label: string;
  sections: NavSection[];
}

export function isNavSectionOpen(
  section: NavSection,
  expandedHref: string | null,
): boolean {
  return (
    !section.comingSoon &&
    section.children !== undefined &&
    expandedHref === section.href
  );
}

const SIDEBAR_STORAGE_KEY = "satulayar-sidebar-collapsed";
const SIDEBAR_STATE_EVENT = "satulayar-sidebar-state";
const SIDEBAR_NAV_ID = "dashboard-primary-navigation";
let sidebarCollapsedFallback = false;

function readSidebarCollapsed(): boolean {
  if (typeof window === "undefined") return false;

  try {
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true";
  } catch {
    return sidebarCollapsedFallback;
  }
}

function subscribeSidebarState(onStoreChange: () => void): () => void {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === SIDEBAR_STORAGE_KEY) onStoreChange();
  };

  window.addEventListener("storage", handleStorage);
  window.addEventListener(SIDEBAR_STATE_EVENT, onStoreChange);

  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(SIDEBAR_STATE_EVENT, onStoreChange);
  };
}

function setSidebarCollapsed(next: boolean): void {
  sidebarCollapsedFallback = next;

  try {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
  } catch {
    // The in-memory fallback still keeps the current page functional.
  }

  window.dispatchEvent(new Event(SIDEBAR_STATE_EVENT));
}

export function DashboardSidebar({
  activeHref,
  brandHref = "/",
  platform,
  children,
  mobileOpen = false,
  onMobileClose,
}: {
  activeHref: string;
  brandHref?: string;
  platform?: Platform;
  children?: ReactNode;
  /** Drives the off-canvas drawer at ≤900px; ignored on desktop widths. */
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}) {
  const persistedCollapsed = useSyncExternalStore(
    subscribeSidebarState,
    readSidebarCollapsed,
    () => false,
  );
  // The mobile drawer always opens in full, labelled form: an icon-only
  // drawer the reader just summoned would defeat the point of opening it.
  const isCollapsed = persistedCollapsed && !mobileOpen;
  const toggleLabel = isCollapsed ? "Expand sidebar" : "Collapse sidebar";

  useEffect(() => {
    if (!mobileOpen) return;

    function handleKeydown(event: KeyboardEvent): void {
      if (event.key === "Escape") onMobileClose?.();
    }

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeydown);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeydown);
    };
  }, [mobileOpen, onMobileClose]);

  return (
    <>
      {mobileOpen && (
        <button
          aria-label="Close navigation"
          className="sidebar-backdrop"
          onClick={onMobileClose}
          type="button"
        />
      )}
      <aside
        aria-label="Primary navigation"
        className={`sidebar ${isCollapsed ? "sidebar--collapsed" : ""} ${
          mobileOpen ? "sidebar--mobile-open" : ""
        }`}
      >
        <div className="sidebar__masthead">
          <Link className="brand" href={brandHref} aria-label="Satulayar dashboard">
            <BrandMark />
            <span className="brand__copy">
              <strong>Satulayar</strong>
              <small>Marketing intelligence</small>
            </span>
          </Link>

          {mobileOpen ? (
            <button
              aria-label="Close navigation"
              className="sidebar__collapse sidebar__collapse--mobile"
              onClick={onMobileClose}
              type="button"
            >
              <CloseIcon />
            </button>
          ) : (
            <button
              aria-controls={SIDEBAR_NAV_ID}
              aria-expanded={!isCollapsed}
              aria-label={toggleLabel}
              className="sidebar__collapse"
              onClick={() => setSidebarCollapsed(!isCollapsed)}
              title={toggleLabel}
              type="button"
            >
              <SidebarToggleIcon isCollapsed={isCollapsed} />
            </button>
          )}
        </div>

        <SidebarNav
          activeHref={activeHref}
          id={SIDEBAR_NAV_ID}
          isCollapsed={isCollapsed}
          onNavigate={onMobileClose}
          platform={platform}
        />

        {children ? <div className="sidebar__footer">{children}</div> : null}
      </aside>
    </>
  );
}

/**
 * The product is one channel today. The menu is grouped so the other channels
 * have an obvious home when they arrive, and so an unbuilt channel reads as
 * planned rather than broken.
 *
 * Every child anchor points at a section that exists on its parent page; the
 * test suite enforces that, so a renamed section cannot leave a dead link.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Channels",
    sections: [
      {
        label: "Paid ads",
        href: "/",
        icon: DashboardIcon,
        children: [
          // Same order as the page, top to bottom.
          { label: "Snapshot", href: "/#snapshot" },
          { label: "Budget pacing", href: "/#budget-pacing" },
          { label: "Platform performance", href: "/#platform-performance" },
          { label: "Delivery trend", href: "/#performance" },
          { label: "Journey metrics", href: "/#journey-metrics" },
          { label: "Blended MER & Store", href: "/#blended-mer" },
          { label: "Audience", href: "/#audience" },
          { label: "Creative fatigue", href: "/#creative-fatigue" },
          { label: "Placement economics", href: "/#placement-performance" },
          { label: "Campaign types", href: "/#campaign-types" },
          { label: "Search terms", href: "/#search-terms" },
          { label: "Intent tiers", href: "/#intent-tiers" },
          { label: "Wasted spend", href: "/#wasted-spend" },
          { label: "Impression share", href: "/#impression-share" },
          { label: "Geography", href: "/#geo-analysis" },
          { label: "Devices", href: "/#device-analysis" },
          { label: "Audience segments", href: "/#audience-segments" },
          { label: "Data health", href: "/#data-health" },
        ],
      },
      {
        label: "Store analytics",
        href: "/store-analytics",
        icon: StoreIcon,
        children: [
          { label: "Yearly performance", href: "/store-analytics#store-yearly" },
          { label: "RFM analysis", href: "/store-analytics#store-rfm" },
          { label: "Cohorts", href: "/store-analytics#store-cohorts" },
          { label: "Store scorecard", href: "/store-analytics#store-scorecard" },
          { label: "Sales", href: "/store-analytics#store-sales" },
          {
            label: "Traffic and conversion",
            href: "/store-analytics#store-traffic",
          },
          { label: "Catalogue", href: "/store-analytics#store-catalogue" },
          { label: "Audience", href: "/store-analytics#store-audience" },
          { label: "Referrers", href: "/store-analytics#store-referrers" },
        ],
      },
      {
        label: "Worklog",
        href: "/worklog",
        icon: NoteIcon,
        children: [
          { label: "Log an action", href: "/worklog#worklog-form" },
          { label: "Logged actions", href: "/worklog#worklog-entries" },
        ],
      },
      { label: "SEO", href: "/", icon: SearchIcon, comingSoon: true },
      { label: "Social media", href: "/", icon: SocialIcon, comingSoon: true },
      { label: "CRM", href: "/", icon: CrmIcon, comingSoon: true },
    ],
  },
  {
    label: "Workspace",
    sections: [
      {
        label: "Data sources",
        href: "/data-sources",
        icon: PlugIcon,
        children: [
          { label: "Google Ads", href: "/data-sources#google-ads" },
          { label: "Meta Ads", href: "/data-sources#meta-ads" },
          { label: "Bing Ads", href: "/data-sources#bing-ads" },
          { label: "TikTok Ads", href: "/data-sources#tiktok-ads" },
          { label: "Google Analytics", href: "/data-sources#google-analytics" },
        ],
      },
      {
        label: "Account",
        href: "/account",
        icon: AccountIcon,
        children: [
          { label: "Profile", href: "/account#session-identity" },
          { label: "Workspaces", href: "/account#workspace-switcher" },
          { label: "Permissions", href: "/account#permissions-grid" },
        ],
      },
    ],
  },
];

/**
 * A section that fits on screen is centred, which is what a reader means by
 * "take me to that card". A section taller than the viewport cannot be centred
 * without pushing its own heading off the top, so it aligns just under the
 * sticky filter bar instead.
 */
const STICKY_OFFSET = 96;

function desiredScrollTop(target: HTMLElement): number {
  const rect = target.getBoundingClientRect();
  const viewport = window.innerHeight;
  const top =
    rect.height <= viewport - STICKY_OFFSET
      ? window.scrollY + rect.top - (viewport - rect.height) / 2
      : window.scrollY + rect.top - STICKY_OFFSET;

  return Math.max(top, 0);
}

export function scrollToSection(hash: string): boolean {
  const id = hash.startsWith("#") ? hash.slice(1) : hash;
  const target = document.getElementById(id);
  if (!target) return false;

  window.scrollTo({ top: desiredScrollTop(target), behavior: "smooth" });
  alignAfterSettle(target);
  return true;
}

/**
 * The sticky filter bar condenses on the way down, which pulls every section up
 * by the height it gave back. Measuring again once the smooth scroll has come
 * to rest, and nudging without animation, is what keeps the card centred
 * instead of landing wherever the layout happened to be when the click fired.
 */
function alignAfterSettle(target: HTMLElement): void {
  let previous = window.scrollY;
  let stillFrames = 0;
  let frames = 0;

  const step = () => {
    frames += 1;
    const current = window.scrollY;
    stillFrames = current === previous ? stillFrames + 1 : 0;
    previous = current;

    // Six identical frames means the animation is over, not merely slow.
    if (stillFrames < 6 && frames < 150) {
      window.requestAnimationFrame(step);
      return;
    }

    const drift = desiredScrollTop(target) - window.scrollY;
    if (Math.abs(drift) > 2) {
      window.scrollTo({
        top: Math.max(window.scrollY + drift, 0),
        behavior: "instant",
      });
    }
  };

  window.requestAnimationFrame(step);
}

export function SidebarNav({
  activeHref,
  id,
  isCollapsed = false,
  onNavigate,
  platform,
}: {
  activeHref: string;
  id?: string;
  isCollapsed?: boolean;
  /** Present on the paid-ads page so platform-only anchors can be hidden. */
  platform?: Platform;
  /** Fires on any nav click; closes the mobile drawer after navigating. */
  onNavigate?: () => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(activeHref);

  // Arriving from another page with a hash should land the same way a click
  // does, not at the browser's default top-of-element position.
  useEffect(() => {
    if (!window.location.hash) return;
    const hash = window.location.hash;
    const timer = window.setTimeout(() => scrollToSection(hash), 60);
    return () => window.clearTimeout(timer);
  }, []);

  function handleAnchor(
    event: MouseEvent<HTMLAnchorElement>,
    href: string,
  ): void {
    const [path, hash] = href.split("#");
    if (!hash) return;
    // Only take over when the anchor is already on this page; a cross-page
    // link must still navigate.
    if (path && path !== window.location.pathname) return;
    if (!scrollToSection(hash)) return;

    event.preventDefault();
    window.history.replaceState(null, "", `#${hash}`);
  }

  return (
    <nav
      aria-label="Dashboard sections"
      className="sidebar__nav"
      id={id}
    >
      {NAV_GROUPS.map((group) => (
        <div className="nav-group-block" key={group.label}>
          <span className="nav-group-block__label">{group.label}</span>

          {group.sections.map((section) => {
            const isActive = section.href === activeHref && !section.comingSoon;
            const isOpen =
              !isCollapsed && isNavSectionOpen(section, expanded);
            const Icon = section.icon;

            if (section.comingSoon) {
              return (
                <span
                  aria-label={`${section.label}, coming soon`}
                  aria-disabled="true"
                  className="nav-link nav-link--soon"
                  key={section.label}
                  title={isCollapsed ? `${section.label} — Coming soon` : undefined}
                >
                  <Icon />
                  <span>{section.label}</span>
                  <em>Soon</em>
                </span>
              );
            }

            return (
              <div className="nav-group" key={section.href}>
                <div
                  className={
                    isActive ? "nav-row nav-row--active" : "nav-row"
                  }
                >
                  <Link
                    aria-label={section.label}
                    aria-current={isActive ? "page" : undefined}
                    className="nav-link"
                    href={section.href}
                    onClick={onNavigate}
                    title={isCollapsed ? section.label : undefined}
                  >
                    <Icon />
                    <span>{section.label}</span>
                  </Link>
                  {section.children && !isCollapsed && (
                    <button
                      aria-expanded={isOpen}
                      aria-label={`${isOpen ? "Collapse" : "Expand"} ${section.label}`}
                      className={`nav-toggle ${isOpen ? "nav-toggle--open" : ""}`}
                      onClick={() =>
                        setExpanded((current) =>
                          current === section.href ? null : section.href,
                        )
                      }
                      type="button"
                    >
                      <ChevronIcon />
                    </button>
                  )}
                </div>

                {isOpen && section.children && (
                  <ul className="nav-sublist">
                    {section.children
                      .filter((child) => {
                        // A hidden section must not leave a link that scrolls
                        // to nothing.
                        if (platform === undefined) return true;
                        const id = anchorSectionId(child.href);
                        return id === null || isSectionVisible(id, platform);
                      })
                      .map((child) => (
                        <li key={child.href}>
                          <Link
                            className="nav-sublink"
                            href={child.href}
                            onClick={(event) => {
                              handleAnchor(event, child.href);
                              onNavigate?.();
                            }}
                          >
                            {child.label}
                          </Link>
                        </li>
                      ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
