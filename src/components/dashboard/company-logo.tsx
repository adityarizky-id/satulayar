"use client";

import Image from "next/image";
import { useState, useMemo, type ReactNode } from "react";

export type LogoLookupType =
  | { domain: string; name?: never; ticker?: never; crypto?: never; isin?: never }
  | { name: string; domain?: never; ticker?: never; crypto?: never; isin?: never }
  | { ticker: string; domain?: never; name?: never; crypto?: never; isin?: never }
  | { crypto: string; domain?: never; name?: never; ticker?: never; isin?: never }
  | { isin: string; domain?: never; name?: never; ticker?: never; crypto?: never };

export type LogoImageFormat = "webp" | "png" | "jpg";
export type LogoTheme = "auto" | "light" | "dark";
export type LogoFallbackMode = "monogram" | "404";

export interface LogoUrlOptions {
  token?: string;
  size?: number;
  format?: LogoImageFormat;
  theme?: LogoTheme;
  retina?: boolean;
  fallback?: LogoFallbackMode;
}

/** Publishable Logo.dev key from the environment; never hardcoded. */
export const DEFAULT_LOGO_DEV_TOKEN = process.env.NEXT_PUBLIC_LOGO_DEV_TOKEN ?? "";

/**
 * Builds the canonical Logo.dev URL based on identifier and configuration options.
 */
export function buildLogoDevUrl(
  lookup: LogoLookupType,
  options: LogoUrlOptions = {}
): string {
  const {
    token = DEFAULT_LOGO_DEV_TOKEN,
    size,
    format = "webp",
    theme,
    retina = true,
    fallback,
  } = options;

  let path = "";
  if (lookup.domain) {
    path = lookup.domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  } else if (lookup.name) {
    path = `name/${encodeURIComponent(lookup.name)}`;
  } else if (lookup.ticker) {
    path = `ticker/${encodeURIComponent(lookup.ticker)}`;
  } else if (lookup.crypto) {
    path = `crypto/${encodeURIComponent(lookup.crypto)}`;
  } else if (lookup.isin) {
    path = `isin/${encodeURIComponent(lookup.isin)}`;
  }

  const searchParams = new URLSearchParams();
  if (token) searchParams.set("token", token);
  if (size) searchParams.set("size", String(size));
  if (format) searchParams.set("format", format);
  if (theme && theme !== "auto") searchParams.set("theme", theme);
  if (retina) searchParams.set("retina", "true");
  if (fallback) searchParams.set("fallback", fallback);

  const query = searchParams.toString();
  return `https://img.logo.dev/${path}${query ? `?${query}` : ""}`;
}

export type CompanyLogoProps = LogoLookupType &
  LogoUrlOptions & {
    alt?: string;
    width?: number;
    height?: number;
    className?: string;
    unoptimized?: boolean;
    fallbackElement?: ReactNode;
  };

/**
 * Reusable Company / Brand Logo component powered by Logo.dev.
 *
 * Supports lookup by:
 * - `domain` (e.g. "kopisenja.org", "google.com")
 * - `name` (e.g. "Kopi Senja Nusantara", "Stripe")
 * - `ticker` (e.g. "AAPL", "MSFT")
 * - `crypto` (e.g. "BTC", "ETH")
 * - `isin` (e.g. "US0378331005")
 */
export function CompanyLogo({
  domain,
  name,
  ticker,
  crypto,
  isin,
  token = DEFAULT_LOGO_DEV_TOKEN,
  size = 128,
  format = "webp",
  theme = "auto",
  retina = true,
  fallback = "monogram",
  alt,
  width = 24,
  height = 24,
  className = "",
  unoptimized = false,
  fallbackElement,
}: CompanyLogoProps) {
  const [hasError, setHasError] = useState(false);

  const lookup = useMemo<LogoLookupType>(() => {
    if (domain) return { domain };
    if (name) return { name };
    if (ticker) return { ticker };
    if (crypto) return { crypto };
    if (isin) return { isin };
    return { domain: "placeholder.com" };
  }, [domain, name, ticker, crypto, isin]);

  const computedAlt = useMemo(() => {
    if (alt) return alt;
    if (domain) return `${domain} logo`;
    if (name) return `${name} logo`;
    if (ticker) return `${ticker} ticker logo`;
    if (crypto) return `${crypto} coin logo`;
    return "Company logo";
  }, [alt, domain, name, ticker, crypto]);

  const logoUrl = useMemo(() => {
    return buildLogoDevUrl(lookup, {
      token,
      size,
      format,
      theme,
      retina,
      fallback,
    });
  }, [lookup, token, size, format, theme, retina, fallback]);

  // Without a key Logo.dev refuses the request, so skip the round trip.
  if ((hasError || !token) && fallbackElement) {
    return <>{fallbackElement}</>;
  }

  return (
    <Image
      src={logoUrl}
      alt={computedAlt}
      width={width}
      height={height}
      className={`company-logo ${className}`.trim()}
      unoptimized={unoptimized}
      onError={() => setHasError(true)}
      style={{
        objectFit: "contain",
        display: "inline-block",
      }}
    />
  );
}
