"use client";

import { useEffect, useId, useRef, useState } from "react";

const METRIC_HINTS: Record<string, string> = {
  spend: "The amount charged by the selected ad platform or platforms in the account's native currency.",
  impressions: "The number of times ads were served. One person can generate multiple impressions.",
  cpm: "Cost per 1,000 impressions: spend divided by impressions, multiplied by 1,000.",
  averageDailyReach: "The average number of distinct Meta accounts that saw an ad on each closed day.",
  averageDailyFrequency: "The average number of ad impressions delivered to each reached Meta account per closed day.",
  clicks: "All recorded ad clicks in the selected platform scope and reporting period.",
  ctr: "Click-through rate: clicks divided by impressions.",
  cpc: "Cost per click: spend divided by recorded clicks.",
  landingPageViews: "Visits where the destination page loaded after an ad click; this can be lower than clicks.",
  clickToLpvRate: "The share of ad clicks that became a loaded landing-page view.",
  costPerLandingPageView: "Ad spend divided by loaded landing-page views.",
  engagedVisits: "Visits where someone stayed past the dwell threshold set on the account's time-on-site conversion action. Google only; Meta reports no comparable signal.",
  addToBaskets: "Baskets started after an ad click, counted by Google's add-to-cart conversion action or Meta's add_to_cart pixel event.",
  lpvToBasketRate: "The share of loaded landing-page views that went on to start a basket.",
  costPerAddToBasket: "Ad spend divided by baskets started.",
  registrations: "Registration events reported under the active platform's configured conversion definition.",
  costPerRegistration: "Cost per acquisition (CPA): spend divided by reported registrations.",
  lpvToRegistrationRate: "The share of landing-page views that produced a reported registration.",
  allConversionRate: "Google All conversions divided by ad interactions. It can include view-through conversions and is not equivalent to Meta's conversion basis.",
  purchases: "Purchases attributed by the selected ad platform. Combined Google and Meta counts are not unique customers.",
  costPerPurchase: "Cost per order (CPO): spend divided by platform-attributed purchases.",
  registrationToPurchaseRate: "Platform-attributed purchases divided by reported registrations.",
  actualPurchaseRevenue: "store revenue assigned to the selected platform scope, kept separate from platform-reported conversion value.",
  averageOrderValue: "Average order value: total sales divided by placed orders.",
  actualRevenueRoas: "Store ROAS: Store-attributed store revenue divided by ad spend.",
  platformRoas: "Platform ROAS: platform-reported conversion value divided by ad spend.",
  platformValue: "Conversion value reported by the ad platform under its own attribution settings.",
  platformValueRatio: "Platform-reported conversion value divided by Store-attributed store revenue. Values above 1 indicate the platform claims more value than the store evidence assigns.",
  grossSales: "Merchandise value before discounts, returns, shipping adjustments, and other deductions.",
  returningCustomerRate: "The share of placed orders made by customers identified as returning in the store-shaped store data.",
  orders: "Orders placed during the selected reporting period, before dispatch or cancellation status is considered.",
  ordersDispatched: "Placed orders marked as dispatched in the store order lifecycle.",
  ordersAwaitingDispatch: "Placed orders not yet dispatched. A rise can reflect either stronger demand or a growing fulfilment backlog.",
  cancelledOrders: "Placed orders whose current store status is cancelled.",
  abandonedBaskets: "Baskets that reached the checkout journey but did not become a completed order in the fixture contract.",
  totalSales: "Net sales (gross sales after discounts and returns) plus shipping and taxes.",
  discounts: "Discount value deducted from gross sales during the selected period.",
  returns: "Value deducted for returned orders represented in the store data contract.",
  netSales: "Gross sales minus discounts and returns, before shipping charges and taxes are added.",
  shippingCharges: "Shipping revenue charged on orders and added after net merchandise sales.",
  taxes: "Tax charged on orders and added after net merchandise sales.",
  sessions: "Recorded store visits in the selected period. A person can generate more than one session.",
  conversionRate: "Completed store checkouts divided by recorded store sessions.",
  salesYtd: "Store sales accumulated from 1 January through the current like-for-like cutoff date.",
  ordersYtd: "Orders placed from 1 January through the current like-for-like cutoff date.",
  strongestMonth: "The prior-year month with the highest total store sales.",
  blendedMer: "Blended marketing efficiency ratio (MER): realized store net sales divided by total paid-ad spend across the active scope.",
  googleRealizedRoas: "Store-realized store revenue assigned to Google Ads divided by Google Ads spend.",
  metaRealizedRoas: "Store-realized store revenue assigned to Meta Ads divided by Meta Ads spend.",
  storeNetSales: "Net sales recorded by the store after the store deductions represented in the current data contract.",
  totalPaidAdSpend: "Google Ads and Meta Ads spend combined for the active account and period.",
  googleAdsSpend: "Google Ads spend for the active account and reporting period.",
  metaAdsSpend: "Meta Ads spend for the active account and reporting period.",
  realizedStoreOrders: "Completed store orders recorded in the store, used as the realized outcome rather than another platform claim.",
  attributionOverlapGap: "Platform-attributed orders minus realized store orders. The gap indicates attribution overlap or double-counting, not additional customers.",
  actionableAccounts: "Store customer records that currently meet at least one defined paid-audience action rule.",
  estimatedWeeklyUplift: "A directional model estimate, not guaranteed revenue. It must be validated before any budget change.",
  rfmSegments: "Recency, frequency, and monetary-value groups used to distinguish recent, repeat, and high-value customer cohorts.",
  customerMatch: "A Google Ads audience built from consented first-party customer data that Google can securely match to signed-in users.",
  lookalikeAudience: "A Meta audience modelled from the characteristics of an approved source audience; it is a prospecting segment, not a customer list.",
  adCountCeiling: "The recommended maximum number of simultaneously active ads in this analysis before delivery becomes too fragmented to judge cleanly.",
  highIntentShare: "The share of classified non-brand search-term spend assigned to the highest commercial-intent tier.",
  detectedWaste: "Spend on search terms classified as irrelevant, consumer-only, research-led, or otherwise outside the approved buying intent.",
  projectedMonthlySavings: "A directional estimate that scales the detected waste pattern to a month. It is not guaranteed savings.",
};

export function metricHintFor(key: string): string | null {
  return METRIC_HINTS[key] ?? null;
}

interface Placement {
  top: number;
  left: number;
  direction: "up" | "down";
}

const BUBBLE_HALF_WIDTH = 130;
const VIEWPORT_MARGIN = 8;
const VERTICAL_GAP = 8;
/** Below this much room above the trigger, open downward instead. */
const MIN_SPACE_ABOVE = 60;
/**
 * The topbar and the filter bar are both `position: sticky` frosted bars that
 * sit above page content (`z-index` 50 and 40). An upward bubble whose top
 * would land behind them is partially hidden under their frost rather than
 * clipped by the viewport, so the first rows of text vanish. The bubble's
 * explicit stacking layer keeps it above both bars, while the live geometry
 * below keeps the preferred placement in clear space whenever there is room.
 */
/*
 * Bottom of the lowest sticky chrome that overlaps the trigger horizontally.
 * Both bars are sticky, so they stay put while the page scrolls under them;
 * a naive `getBoundingClientRect()` comparison against a stale measurement
 * would be wrong after any scroll. Reading live rects at measure time keeps
 * the answer honest.
 */
function stickyChromeBottomAt(triggerRect: DOMRect): number {
  let lowest = 0;
  for (const selector of [".topbar", ".filter-bar"]) {
    const bar = document.querySelector(selector);
    if (!bar) continue;
    const rect = bar.getBoundingClientRect();
    const overlapsHorizontally =
      rect.right > triggerRect.left && rect.left < triggerRect.right;
    if (overlapsHorizontally) lowest = Math.max(lowest, rect.bottom);
  }
  return lowest;
}

/**
 * Small "i" trigger for the caveat text a metric card used to carry only in
 * its native `title` attribute — invisible until a reader happened to hover
 * the exact right pixel.
 *
 * Position is measured in JS, not pure CSS: a card near the top of the
 * viewport (the first journey-metric row is a common case) has no room for
 * an upward-opening bubble, and pure `:hover`/`:focus` CSS cannot see the
 * viewport to flip direction. `getBoundingClientRect()` on open decides
 * up vs down and clamps left/right, then the bubble renders `position:
 * fixed` so it is never clipped by a card's own overflow.
 */
export function MetricHint({ label, text }: { label?: string; text: string }) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const tooltipId = useId();

  function measure() {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const chromeBottom = stickyChromeBottomAt(rect);
    const roomAboveChrome = rect.top - chromeBottom;
    const direction: Placement["direction"] =
      roomAboveChrome >= MIN_SPACE_ABOVE ? "up" : "down";
    const centerX = rect.left + rect.width / 2;
    const clampedLeft = Math.min(
      Math.max(centerX, BUBBLE_HALF_WIDTH + VIEWPORT_MARGIN),
      window.innerWidth - BUBBLE_HALF_WIDTH - VIEWPORT_MARGIN,
    );

    // An upward bubble hangs below its own top edge, so its top must clear
    // the sticky chrome by a gap — not merely sit under it. When the space
    // between chrome and trigger is too narrow for the full bubble, open
    // downward into the clear space below instead; the snapshot rows there
    // are chrome-free, and a downward bubble never overlaps its trigger.
    const top =
      direction === "up"
        ? Math.max(rect.top - VERTICAL_GAP, chromeBottom + VERTICAL_GAP)
        : rect.bottom + VERTICAL_GAP;

    setPlacement({ top, left: clampedLeft, direction });
  }

  function clear() {
    setPlacement(null);
  }

  // A wheel/trackpad scroll while the pointer stays put does not re-fire
  // mouseenter, so the fixed-position bubble would otherwise drift away
  // from its trigger. Closing on scroll is simpler and just as correct as
  // re-measuring, since the reader can hover again once they stop.
  useEffect(() => {
    if (!placement) return;
    window.addEventListener("scroll", clear, { capture: true, passive: true });
    return () =>
      window.removeEventListener("scroll", clear, { capture: true });
  }, [placement]);

  return (
    <span className="metric-hint">
      <button
        aria-describedby={placement ? tooltipId : undefined}
        aria-label={`More information${label ? ` about ${label}` : ""}`}
        className="metric-hint__trigger"
        onBlur={clear}
        onFocus={measure}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            clear();
            triggerRef.current?.blur();
          }
        }}
        onMouseEnter={measure}
        onMouseLeave={clear}
        ref={triggerRef}
        type="button"
      >
        i
      </button>
      {placement && (
        <span
          className={`metric-hint__bubble metric-hint__bubble--${placement.direction}`}
          id={tooltipId}
          role="tooltip"
          style={{ top: placement.top, left: placement.left }}
        >
          {text}
        </span>
      )}
    </span>
  );
}
