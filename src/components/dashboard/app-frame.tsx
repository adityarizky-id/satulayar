"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { DashboardSidebar } from "@/components/dashboard/sidebar-nav";
import { ThemeToggle } from "@/components/dashboard/theme-toggle";
import { MenuIcon } from "@/components/dashboard/icons";
import type { DashboardViewer } from "@/lib/auth/types";
import type { Platform } from "@/lib/dashboard/types";
import { BrandMark } from "@/components/dashboard/brand-mark";

/** Wrapped utility controls must never cover the sticky reporting picker. */
export function useUtilityBarHeight() {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const bar = ref.current;
    if (!bar) return;
    const panel = bar.closest<HTMLElement>(".main-panel") ?? bar.closest(".app-frame")?.querySelector<HTMLElement>(".main-panel");
    const frame = bar.closest<HTMLElement>(".app-frame");
    const measure = () => {
      const height = `${bar.getBoundingClientRect().height}px`;
      panel?.style.setProperty("--utility-bar-height", height);
      frame?.style.setProperty("--utility-bar-height", height);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    return () => {
      observer.disconnect();
      panel?.style.removeProperty("--utility-bar-height");
      frame?.style.removeProperty("--utility-bar-height");
    };
  }, []);
  return ref;
}

/** Expand grouped headers into the labels that travel with each metric on small screens. */
export function resolveTableColumnLabels(rows: { label: string; colSpan: number; rowSpan: number }[][]): string[] {
  const grid: string[][] = [];
  rows.forEach((cells, row) => {
    grid[row] ??= [];
    let column = 0;
    for (const cell of cells) {
      while (grid[row][column] !== undefined) column += 1;
      for (let y = row; y < row + cell.rowSpan; y += 1) {
        grid[y] ??= [];
        for (let x = column; x < column + cell.colSpan; x += 1) grid[y][x] = cell.label;
      }
      column += cell.colSpan;
    }
  });
  return Array.from({ length: Math.max(0, ...grid.map((row) => row.length)) }, (_, column) =>
    [...new Set(grid.map((row) => row[column]).filter(Boolean))].join(" · "),
  );
}

/** Progressive enhancement preserves native tables and also covers lazy tabs and sorted rows. */
export function useResponsiveTables() {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    const enhance = () => {
      host.querySelectorAll<HTMLTableElement>(".table-scroller > table, .connector-runtime__table-wrap > table").forEach((table) => {
        if (!table.tHead) return;
        const labels = resolveTableColumnLabels(Array.from(table.tHead.rows, (row) => Array.from(row.cells, (cell) => {
          const copy = cell.cloneNode(true) as HTMLElement;
          copy.querySelectorAll('[aria-hidden="true"], button[aria-label^="More information"], .platform-performance-table__source-heading small').forEach((element) => element.remove());
          return { label: copy.textContent?.replace(/\s+/g, " ").trim() ?? "", colSpan: cell.colSpan, rowSpan: cell.rowSpan };
        })));
        if (!labels.length) return;
        table.setAttribute("role", "table");
        Array.from(table.tHead.rows).forEach((row) => {
          row.setAttribute("role", "row");
          Array.from(row.cells).forEach((cell) => cell.setAttribute("role", "columnheader"));
        });
        table.tHead.setAttribute("role", "rowgroup");
        Array.from(table.tBodies).forEach((body) => {
          body.setAttribute("role", "rowgroup");
          Array.from(body.rows).forEach((row) => {
            row.setAttribute("role", "row");
            let column = 0;
            Array.from(row.cells).forEach((cell) => {
              cell.dataset.label = labels.slice(column, column + cell.colSpan).join(" / ");
              cell.setAttribute("role", cell.tagName === "TH" ? "rowheader" : "cell");
              cell.classList.toggle("table-reflow__span", cell.colSpan > 1);
              column += cell.colSpan;
            });
          });
        });
        const wrapper = table.parentElement!;
        wrapper.classList.add("table-reflow-ready");
        wrapper.classList.toggle("table-reflow--wide", labels.length > 7);
        wrapper.classList.toggle("table-reflow--sortable", Boolean(table.tHead.querySelector('button:not([aria-label^="More information"])')));
      });
    };
    enhance();
    let frame = 0;
    const observer = new MutationObserver((records) => {
      const relevant = records.some((record) => {
        const element = record.target instanceof Element ? record.target : record.target.parentElement;
        return element?.closest("table") || Array.from(record.addedNodes).some((node) => node instanceof Element && (node.matches("table") || node.querySelector("table")));
      });
      if (!relevant || frame) return;
      frame = requestAnimationFrame(() => { frame = 0; enhance(); });
    });
    observer.observe(host, { childList: true, subtree: true, characterData: true });
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, []);
  return ref;
}

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
  const topbarRef = useUtilityBarHeight();
  const tableLayoutRef = useResponsiveTables();
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

  const isPaidDashboard = activeHref === "/";
  const utilityHeader = (
    <header className="topbar" ref={topbarRef}>
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
          {activeHref === "/" ? topbar : <div className="topbar__operations">{topbar}</div>}
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
  );

  return (
    <div className={`app-frame${isPaidDashboard ? " app-frame--paid" : ""}${activeHref === "/store-analytics" ? " app-frame--store" : ""}${activeHref === "/worklog" ? " app-frame--worklog" : ""}${activeHref === "/account" ? " app-frame--account" : ""}${activeHref === "/data-sources" ? " app-frame--sources" : ""}`}>
      <a className="skip-link" href="#main-content">{skipLinkLabel}</a>

      {isPaidDashboard && utilityHeader}

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

      <main className="main-panel" id="main-content" ref={tableLayoutRef}>
        {!isPaidDashboard && utilityHeader}

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
