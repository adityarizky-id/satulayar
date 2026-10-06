"use client";

import { useEffect, useRef } from "react";

export type DashboardTheme = "light" | "dark";

export const DASHBOARD_THEME_STORAGE_KEY = "satulayar-theme";

function isDashboardTheme(value: string | null): value is DashboardTheme {
  return value === "light" || value === "dark";
}

function preferredTheme(): DashboardTheme {
  if (typeof window === "undefined") return "light";

  try {
    const stored = window.localStorage.getItem(DASHBOARD_THEME_STORAGE_KEY);
    if (isDashboardTheme(stored)) return stored;
  } catch {
    // Storage can be unavailable in hardened or private browser contexts.
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function applyTheme(theme: DashboardTheme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

function syncAccessibleState(
  button: HTMLButtonElement | null,
  theme: DashboardTheme,
) {
  if (!button) return;

  const nextTheme = theme === "light" ? "dark" : "light";
  button.setAttribute("aria-pressed", String(theme === "dark"));
  button.setAttribute("aria-label", `Use ${nextTheme} theme`);
  button.title = `Use ${nextTheme} theme`;
}

export function ThemeToggle() {
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const nextTheme = preferredTheme();
    applyTheme(nextTheme);
    syncAccessibleState(buttonRef.current, nextTheme);
  }, []);

  function toggleTheme() {
    const theme = document.documentElement.dataset.theme === "dark"
      ? "dark"
      : "light";
    const nextTheme = theme === "light" ? "dark" : "light";
    applyTheme(nextTheme);
    syncAccessibleState(buttonRef.current, nextTheme);

    try {
      window.localStorage.setItem(DASHBOARD_THEME_STORAGE_KEY, nextTheme);
    } catch {
      // The selected theme still applies for this page view without storage.
    }
  }

  return (
    <button
      aria-label="Toggle color theme"
      aria-pressed="false"
      className="theme-toggle"
      onClick={toggleTheme}
      ref={buttonRef}
      title="Toggle color theme"
      type="button"
    >
      <span aria-hidden="true" className="theme-toggle__icon theme-toggle__icon--sun">
        <svg viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="3.25" />
          <path d="M12 2.75v2M12 19.25v2M2.75 12h2M19.25 12h2M5.46 5.46l1.42 1.42M17.12 17.12l1.42 1.42M18.54 5.46l-1.42 1.42M6.88 17.12l-1.42 1.42" />
        </svg>
      </span>
      <span aria-hidden="true" className="theme-toggle__track">
        <span className="theme-toggle__thumb" />
      </span>
      <span aria-hidden="true" className="theme-toggle__icon theme-toggle__icon--moon">
        <svg viewBox="0 0 24 24">
          <path d="M19.15 15.2A7.8 7.8 0 0 1 8.8 4.85a8.2 8.2 0 1 0 10.35 10.35Z" />
        </svg>
      </span>
    </button>
  );
}
