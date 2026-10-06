/**
 * The Satulayar mark: one screen carrying one rising line — every channel read
 * on a single surface. The same geometry is drawn in `src/app/icon.svg`, so the
 * browser tab and the product chrome always show the same symbol.
 */
export function BrandGlyph({ className = "brand__glyph" }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24">
      <rect fill="currentColor" height="12.5" rx="2.5" width="18" x="3" y="4.5" />
      <path
        d="M6.5 13.5 10 10l3 2 4.5-4.5"
        stroke="var(--brand-mark-ink)"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <rect fill="currentColor" height="1.8" rx="0.9" width="6" x="9" y="18.6" />
    </svg>
  );
}

/** The glyph on its green tile, as used beside the wordmark. */
export function BrandMark() {
  return (
    <span aria-hidden="true" className="brand__mark">
      <BrandGlyph />
    </span>
  );
}
