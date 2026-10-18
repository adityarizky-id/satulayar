"use client";

import { BrandMark } from "@/components/dashboard/brand-mark";
import { GoogleAdsIcon, MetaAdsIcon, StoreIcon } from "@/components/dashboard/icons";

export function AuthStageVisual() {
  return (
    <aside className="auth-stage">
      <div aria-hidden="true" className="auth-stage__network">
        <svg fill="none" viewBox="0 0 800 800">
          <circle cx="540" cy="360" r="220" />
          <circle cx="540" cy="360" r="310" />
          <circle cx="540" cy="360" r="400" />
          <path d="M100 600 260 470 400 500 540 360 680 280 800 320" />
          <path d="M260 470 300 280 540 360 610 100M400 500 600 630 680 280" />
          <g className="auth-stage__network-nodes">
            <circle cx="260" cy="470" r="5" /><circle cx="400" cy="500" r="5" />
            <circle cx="540" cy="360" r="7" /><circle cx="680" cy="280" r="5" />
          </g>
        </svg>
      </div>

      <div className="auth-stage__container">
        <div className="auth-stage__topmark">
          <BrandMark />
          <div className="auth-stage__badge">
            <span className="auth-stage__dot" />
            <span>Satulayar Unified Telemetry</span>
          </div>
        </div>

        <div className="auth-stage__copy">
          <div className="auth-stage__headline-box">
            <h1 className="auth-stage__headline">Turn ad spend<br /><span>into answers.</span></h1>
          </div>
          <p className="auth-stage__sub">
            Google Ads, Meta Ads, Bing Ads, and store performance for every brand you manage — read in one view.
          </p>
          <ul aria-label="Reporting sources" className="auth-stage__sources">
            <li><GoogleAdsIcon aria-hidden="true" />Google Ads</li>
            <li><MetaAdsIcon aria-hidden="true" />Meta Ads</li>
            <li><StoreIcon aria-hidden="true" />Store analytics</li>
          </ul>
        </div>

        <div className="auth-stage__feed">
          <div className="auth-stage__feed-heading"><span>One connected view</span><span>Demo workspace</span></div>
          <div className="auth-stage__feed-flow">
            <div><small>01 / ACQUISITION</small><strong>Ad performance</strong><span>Spend, reach &amp; conversions</span></div>
            <div><small>02 / OUTCOMES</small><strong>Store performance</strong><span>Revenue, orders &amp; retention</span></div>
            <div><small>03 / CONTEXT</small><strong>Reviewed actions</strong><span>Changes alongside the data</span></div>
          </div>
          <p>Preview shown with fictional data. Connect your sources to report on your own workspace.</p>
        </div>
      </div>
    </aside>
  );
}
