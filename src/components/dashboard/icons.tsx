import { type SVGProps } from "react";
import type { WorklogPlatform } from "@/lib/dashboard/types";

type IconProps = SVGProps<SVGSVGElement>;

function IconBase({ children, ...props }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="20"
      viewBox="0 0 24 24"
      width="20"
      {...props}
    >
      {children}
    </svg>
  );
}

export function DashboardIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect height="7" rx="2" stroke="currentColor" strokeWidth="1.8" width="7" x="3" y="3" />
      <rect height="11" rx="2" stroke="currentColor" strokeWidth="1.8" width="7" x="14" y="3" />
      <rect height="7" rx="2" stroke="currentColor" strokeWidth="1.8" width="7" x="14" y="16" />
      <rect height="11" rx="2" stroke="currentColor" strokeWidth="1.8" width="7" x="3" y="12" />
    </IconBase>
  );
}

export function TrendIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m4 17 5-5 4 3 7-8" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
      <path d="M15 7h5v5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </IconBase>
  );
}

export function NoteIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M6 3h9l3 3v15H6z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
      <path d="M15 3v4h4M9 11h6M9 15h6" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </IconBase>
  );
}

export function AccountIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.8" />
      <path d="M4 21c.7-4 3.3-6 8-6s7.3 2 8 6" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </IconBase>
  );
}

export function CrmIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect height="16" rx="3" stroke="currentColor" strokeWidth="1.8" width="18" x="3" y="4" />
      <circle cx="9" cy="10" r="2.2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M6 17c.4-2 1.4-3 3-3s2.6 1 3 3M15 9h3M15 13h3M15 17h2" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </IconBase>
  );
}

export function RefreshIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M20 7v5h-5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
      <path d="M18.2 16A8 8 0 1 1 19.7 9L20 12" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </IconBase>
  );
}

export function DownloadIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 4v10" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      <path d="m7.5 10.5 4.5 4.5 4.5-4.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
      <path d="M5 18.5h14" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </IconBase>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path
        d="m5 12.5 4.2 4.2L19 7"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </IconBase>
  );
}

export function StoreIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 4h16l1 5a3 3 0 0 1-5.5 1.7A3 3 0 0 1 12 11a3 3 0 0 1-3.5-.3A3 3 0 0 1 3 9Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
      <path d="M5 11v9h14v-9M10 20v-5h4v5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </IconBase>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="11" cy="11" r="6" stroke="currentColor" strokeWidth="1.8" />
      <path d="m16 16 4 4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </IconBase>
  );
}

export function SocialIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="7" cy="12" r="2.6" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="17" cy="6.5" r="2.6" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="17" cy="17.5" r="2.6" stroke="currentColor" strokeWidth="1.8" />
      <path d="m9.3 10.8 5.4-3M9.3 13.2l5.4 3" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </IconBase>
  );
}

export function PlugIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M9 3v5M15 3v5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      <path d="M6 8h12v3a6 6 0 0 1-6 6 6 6 0 0 1-6-6z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
      <path d="M12 17v4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </IconBase>
  );
}

export function ChevronIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m8 10 4 4 4-4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </IconBase>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </IconBase>
  );
}

export function MenuIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </IconBase>
  );
}

export function SidebarToggleIcon({
  isCollapsed,
  ...props
}: IconProps & { isCollapsed: boolean }) {
  return (
    <IconBase {...props}>
      <rect
        height="16"
        rx="3"
        stroke="currentColor"
        strokeWidth="1.8"
        width="18"
        x="3"
        y="4"
      />
      <path
        d="M9 4v16"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
      <path
        d={isCollapsed ? "m13 9 3 3-3 3" : "m16 9-3 3 3 3"}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </IconBase>
  );
}

export function LightbulbIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path
        d="M9 18h6M10 21h4M12 3a6.5 6.5 0 0 0-6.5 6.5c0 2.4 1.3 4.5 3.2 5.6.5.3.8.8.8 1.4v.5h5v-.5c0-.6.3-1.1.8-1.4 1.9-1.1 3.2-3.2 3.2-5.6A6.5 6.5 0 0 0 12 3z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </IconBase>
  );
}

/**
 * Brand marks, not UI glyphs: real platform colors, no `currentColor`. Shared
 * here so the data-sources catalogue and the account brand cards render the
 * same Google and Meta identity instead of two independently drawn copies
 * drifting apart.
 */
export function GoogleAdsIcon(props: IconProps) {
  const width =
    typeof props.width === "number"
      ? props.width
      : props.width
        ? parseInt(String(props.width), 10)
        : 20;
  const height =
    typeof props.height === "number"
      ? props.height
      : props.height
        ? parseInt(String(props.height), 10)
        : 20;

  const { className, style } = props;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      alt="Google Ads"
      className={className}
      decoding="async"
      height={height}
      loading="eager"
      src="/brand/google-ads.png"
      style={{
        width: typeof width === "number" ? `${width}px` : width,
        height: typeof height === "number" ? `${height}px` : height,
        objectFit: "contain",
        display: "inline-block",
        verticalAlign: "middle",
        flexShrink: 0,
        ...style,
      }}
      width={width}
    />
  );
}

export function MetaAdsIcon(props: IconProps) {
  const width =
    typeof props.width === "number"
      ? props.width
      : props.width
        ? parseInt(String(props.width), 10)
        : 20;
  const height =
    typeof props.height === "number"
      ? props.height
      : props.height
        ? parseInt(String(props.height), 10)
        : 20;

  const { className, style } = props;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      alt="Meta Ads"
      className={className}
      decoding="async"
      height={height}
      loading="eager"
      src="/brand/meta-ads.png"
      style={{
        width: typeof width === "number" ? `${width}px` : width,
        height: typeof height === "number" ? `${height}px` : height,
        objectFit: "contain",
        display: "inline-block",
        verticalAlign: "middle",
        flexShrink: 0,
        ...style,
      }}
      width={width}
    />
  );
}

export function TikTokAdsIcon(props: IconProps) {
  const width =
    typeof props.width === "number"
      ? props.width
      : props.width
        ? parseInt(String(props.width), 10)
        : 20;
  const height =
    typeof props.height === "number"
      ? props.height
      : props.height
        ? parseInt(String(props.height), 10)
        : 20;

  const { className, style } = props;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      alt="TikTok Ads"
      className={className}
      decoding="async"
      height={height}
      loading="eager"
      src="/brand/tiktok-ads.png"
      style={{
        width: typeof width === "number" ? `${width}px` : width,
        height: typeof height === "number" ? `${height}px` : height,
        objectFit: "contain",
        display: "inline-block",
        verticalAlign: "middle",
        flexShrink: 0,
        ...style,
      }}
      width={width}
    />
  );
}

export function BingAdsIcon(props: IconProps) {
  const width =
    typeof props.width === "number"
      ? props.width
      : props.width
        ? parseInt(String(props.width), 10)
        : 20;
  const height =
    typeof props.height === "number"
      ? props.height
      : props.height
        ? parseInt(String(props.height), 10)
        : 20;

  const { className, style } = props;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      alt="Microsoft Advertising"
      className={className}
      decoding="async"
      height={height}
      loading="eager"
      src="/brand/bing-ads.png"
      style={{
        width: typeof width === "number" ? `${width}px` : width,
        height: typeof height === "number" ? `${height}px` : height,
        objectFit: "contain",
        display: "inline-block",
        verticalAlign: "middle",
        flexShrink: 0,
        ...style,
      }}
      width={width}
    />
  );
}

export const MicrosoftAdvertisingIcon = BingAdsIcon;

/** Generic glyph for a store connector; reuses the navigation store icon. */
export function StoreSourceIcon(props: IconProps) {
  return <StoreIcon {...props} />;
}

export function ShopifyIcon(props: IconProps) {
  const width =
    typeof props.width === "number"
      ? props.width
      : props.width
        ? parseInt(String(props.width), 10)
        : 20;
  const height =
    typeof props.height === "number"
      ? props.height
      : props.height
        ? parseInt(String(props.height), 10)
        : 20;

  const { className, style } = props;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      alt="Shopify Store"
      className={className}
      decoding="async"
      height={height}
      loading="eager"
      src="/brand/shopify.png"
      style={{
        width: typeof width === "number" ? `${width}px` : width,
        height: typeof height === "number" ? `${height}px` : height,
        objectFit: "contain",
        display: "inline-block",
        verticalAlign: "middle",
        flexShrink: 0,
        ...style,
      }}
      width={width}
    />
  );
}

export function GoogleSearchConsoleIcon(props: IconProps) {
  const width =
    typeof props.width === "number"
      ? props.width
      : props.width
        ? parseInt(String(props.width), 10)
        : 20;
  const height =
    typeof props.height === "number"
      ? props.height
      : props.height
        ? parseInt(String(props.height), 10)
        : 20;

  const { className, style } = props;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      alt="Google Search Console"
      className={className}
      decoding="async"
      height={height}
      loading="eager"
      src="/brand/google-search-console.png"
      style={{
        width: typeof width === "number" ? `${width}px` : width,
        height: typeof height === "number" ? `${height}px` : height,
        objectFit: "contain",
        display: "inline-block",
        verticalAlign: "middle",
        flexShrink: 0,
        ...style,
      }}
      width={width}
    />
  );
}

export function Ga4Icon(props: IconProps) {
  const width =
    typeof props.width === "number"
      ? props.width
      : props.width
        ? parseInt(String(props.width), 10)
        : 20;
  const height =
    typeof props.height === "number"
      ? props.height
      : props.height
        ? parseInt(String(props.height), 10)
        : 20;

  const { className, style } = props;

  return (
    <svg
      aria-hidden="true"
      className={className}
      height={height}
      style={{
        display: "inline-block",
        verticalAlign: "middle",
        flexShrink: 0,
        ...style,
      }}
      viewBox="0 0 24 24"
      width={width}
      fill="none"
    >
      <circle cx="5" cy="18.5" r="2.5" fill="#F9AB00" />
      <rect x="9.5" y="8" width="5" height="13" rx="2.5" fill="#F9AB00" />
      <rect x="16.5" y="2.5" width="5" height="18.5" rx="2.5" fill="#E37400" />
    </svg>
  );
}

export const GoogleAnalyticsIcon = Ga4Icon;

export function AllPlatformsIcon(props: IconProps) {
  const width =
    typeof props.width === "number"
      ? props.width
      : props.width
        ? parseInt(String(props.width), 10)
        : 14;
  const height =
    typeof props.height === "number"
      ? props.height
      : props.height
        ? parseInt(String(props.height), 10)
        : 14;

  const { className, style } = props;

  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      height={height}
      style={{
        display: "inline-block",
        verticalAlign: "middle",
        flexShrink: 0,
        ...style,
      }}
      viewBox="0 0 24 24"
      width={width}
      {...props}
    >
      <path
        d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

export function OtherPlatformIcon(props: IconProps) {
  const width =
    typeof props.width === "number"
      ? props.width
      : props.width
        ? parseInt(String(props.width), 10)
        : 14;
  const height =
    typeof props.height === "number"
      ? props.height
      : props.height
        ? parseInt(String(props.height), 10)
        : 14;

  const { className, style } = props;

  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      height={height}
      style={{
        display: "inline-block",
        verticalAlign: "middle",
        flexShrink: 0,
        ...style,
      }}
      viewBox="0 0 24 24"
      width={width}
      {...props}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <path
        d="M12 8v8M8 12h8"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2"
      />
    </svg>
  );
}

export function WorklogPlatformIcon({
  platform,
  width = 14,
  height = 14,
  className,
}: {
  platform: WorklogPlatform;
  width?: number;
  height?: number;
  className?: string;
}) {
  switch (platform) {
    case "google":
      return <GoogleAdsIcon className={className} width={width} height={height} />;
    case "meta":
      return <MetaAdsIcon className={className} width={width} height={height} />;
    case "tiktok":
      return <TikTokAdsIcon className={className} width={width} height={height} />;
    case "ga4":
      return <Ga4Icon className={className} width={width} height={height} />;
    case "bing":
      return <BingAdsIcon className={className} width={width} height={height} />;
    case "all":
      return <AllPlatformsIcon className={className} width={width} height={height} />;
    case "other":
    default:
      return <OtherPlatformIcon className={className} width={width} height={height} />;
  }
}


