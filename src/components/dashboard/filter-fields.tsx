"use client";

import { ChevronIcon } from "@/components/dashboard/icons";
import {
  ACCOUNT_COOKIE,
  ADVERTISING_PLATFORM_CATALOG,
  type AccountOption,
} from "@/lib/dashboard/accounts";
import type { Platform } from "@/lib/dashboard/types";

type FieldVariant = "standard" | "utility";

/**
 * The chosen brand is stored in a first-party cookie so both analysis pages
 * open on the same account. It holds a public brand slug only.
 */
export function rememberAccount(slug: string) {
  document.cookie = `${ACCOUNT_COOKIE}=${encodeURIComponent(slug)}; path=/; max-age=${
    60 * 60 * 24 * 180
  }; samesite=lax`;
}

export function AccountField({
  accounts,
  value,
  onChange,
  disabled,
  variant = "standard",
}: {
  accounts: AccountOption[];
  value: string;
  onChange: (slug: string) => void;
  disabled?: boolean;
  variant?: FieldVariant;
}) {
  const fieldLabel = "Account";
  const accessibleLabel = variant === "utility" ? "Active account" : fieldLabel;
  const activeAccount =
    accounts.find((account) => account.slug === value) ?? accounts[0];

  return (
    <label
      className={
        variant === "utility"
          ? "utility-field utility-field--account"
          : "field"
      }
    >
      <span className={variant === "utility" ? "visually-hidden" : undefined}>
        {fieldLabel}
      </span>
      <span className="select-wrap select-wrap--account">
        {/*
          The control sizes itself to the brand actually selected. A native
          select cannot do that: left alone it either sizes to the widest option
          or to whatever width the layout hands it, which is how
          "Kopi Senja Nusantara" ended up clipped mid-word and running
          under the currency chip.

          So an invisible copy of the active name sits in normal flow and sets
          the width, and the select is laid over it. The copy carries the same
          font and the same trailing space as the select, so the two always
          agree. It is `aria-hidden` and hidden by `visibility`, which keeps it
          out of the accessibility tree while it still occupies its space — the
          select above it remains the only thing announced or focusable.
        */}
        <span aria-hidden="true" className="select-wrap__sizer">
          {activeAccount?.name ?? value}
        </span>
        <select
          aria-label={`${accessibleLabel}. ${activeAccount?.name ?? value}, native currency ${activeAccount?.currency ?? "unknown"}.`}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          value={value}
        >
          {accounts.map((account) => (
            <option key={account.slug} value={account.slug}>
              {account.name}
            </option>
          ))}
        </select>
        {activeAccount && (
          <span aria-hidden="true" className="field-unit-chip">
            {activeAccount.currency}
          </span>
        )}
        <ChevronIcon />
      </span>
    </label>
  );
}

export function PlatformField({
  activePlatforms,
  value,
  onChange,
  disabled,
  variant = "standard",
}: {
  activePlatforms: Exclude<Platform, "all">[];
  value: Platform;
  onChange: (platform: Platform) => void;
  disabled?: boolean;
  variant?: FieldVariant;
}) {
  const activeOptions = ADVERTISING_PLATFORM_CATALOG.filter(
    (platform) =>
      platform.availability === "active" &&
      activePlatforms.includes(platform.id),
  );
  const plannedOptions = ADVERTISING_PLATFORM_CATALOG.filter(
    (platform) => platform.availability === "planned",
  );
  const fieldLabel = "Platform";
  const accessibleLabel = variant === "utility" ? "Active platform" : fieldLabel;
  const selectedLabel =
    value === "all"
      ? "All platforms"
      : ADVERTISING_PLATFORM_CATALOG.find((platform) => platform.id === value)
          ?.label ?? value;

  return (
    <label
      className={
        variant === "utility"
          ? "utility-field utility-field--platform"
          : "field"
      }
    >
      <span className={variant === "utility" ? "visually-hidden" : undefined}>
        {fieldLabel}
      </span>
      <span className="select-wrap">
        <select
          aria-label={`${accessibleLabel}. ${selectedLabel} selected.`}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value as Platform)}
          value={value}
        >
          {activeOptions.length > 1 && (
            <option value="all">All Platforms</option>
          )}
          {activeOptions.map((platform) => (
            <option key={platform.id} value={platform.id}>
              {platform.label}
            </option>
          ))}
          {plannedOptions.map((platform) => (
            <option disabled key={platform.id} value={platform.id}>
              {platform.label} · coming soon
            </option>
          ))}
        </select>
        <ChevronIcon />
      </span>
    </label>
  );
}

