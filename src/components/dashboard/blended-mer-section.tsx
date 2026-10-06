"use client";

import React, { useState } from "react";
import type {
  BlendedMerSummary,
  Currency,
  Platform,
  RfmPaidAudienceBridge,
} from "@/lib/dashboard/types";
import { formatCurrency } from "@/lib/dashboard/account-contract";
import {
  CheckIcon,
  DownloadIcon,
  SearchIcon,
} from "@/components/dashboard/icons";
import {
  MetricHint,
  metricHintFor,
} from "@/components/dashboard/metric-hint";

interface BlendedMerSectionProps {
  blendedMer: BlendedMerSummary;
  rfmBridge: RfmPaidAudienceBridge;
  currency: Currency;
  selectedPlatform?: Platform;
}

export function BlendedMerSection({
  blendedMer,
  rfmBridge,
  currency,
  selectedPlatform = "all",
}: BlendedMerSectionProps) {
  const [downloadedCardId, setDownloadedCardId] = useState<string | null>(null);

  const handleExportAudience = (cardId: string, fileName: string, cohortLabel: string) => {
    const headers = "email,phone,first_name,last_name,country,cohort_segment\n";
    const sampleRows = [
      `buyer.one@example.com,+6281200000001,Dewi,Santoso,ID,"${cohortLabel}"`,
      `orders@example.com,+6281200000002,Raka,Wijaya,ID,"${cohortLabel}"`,
      `reseller@example.com,+6281200000003,Sari,Kusuma,ID,"${cohortLabel}"`,
      `procurement@example.com,+60120000004,Hafiz,Rahman,MY,"${cohortLabel}"`,
      `studio@example.com,+6580000005,Mei Ling,Tan,SG,"${cohortLabel}"`,
    ].join("\n");

    const blob = new Blob([headers + sampleRows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setDownloadedCardId(cardId);
    setTimeout(() => setDownloadedCardId(null), 3000);
  };

  const isGoogle = selectedPlatform === "google";
  const isMeta = selectedPlatform === "meta";

  // Dynamic context copy based on selected platform filter
  const headerTag = isGoogle
    ? "Store ➔ Google Ads Loop"
    : isMeta
      ? "Store ➔ Meta Ads Loop"
      : "Unified Cash Economics";

  const headerTagClass = isGoogle
    ? "diagnostic-tag diagnostic-tag--google"
    : isMeta
      ? "diagnostic-tag diagnostic-tag--meta"
      : "diagnostic-tag diagnostic-tag--verdant";

  const sectionTitle = isGoogle
    ? "Google Ads store ROAS reconciliation"
    : isMeta
      ? "Meta Ads store ROAS reconciliation"
      : "Blended MER and attribution check";

  const sectionDesc = isGoogle
    ? "Compare Google Ads attribution with realized store outcomes to surface any reporting gap."
    : isMeta
      ? "Compare Meta Ads attribution with realized store outcomes to surface any reporting gap."
      : "Compare platform-attributed purchases with realized store outcomes to surface overlap across channels.";

  const kpiLabel = isGoogle ? "Google realized ROAS" : isMeta ? "Meta realized ROAS" : "Blended MER";
  const kpiHint = metricHintFor(
    isGoogle ? "googleRealizedRoas" : isMeta ? "metaRealizedRoas" : "blendedMer",
  )!;
  const kpiValueClass = isGoogle
    ? "diagnostic-kpi-card__val diagnostic-kpi-card__val--google"
    : isMeta
      ? "diagnostic-kpi-card__val diagnostic-kpi-card__val--meta"
      : "diagnostic-kpi-card__val diagnostic-kpi-card__val--verdant";

  const spendLabel = isGoogle
    ? "Google Ads spend"
    : isMeta
      ? "Meta Ads spend"
      : "Total paid-ad spend";
  const spendHint = metricHintFor(
    isGoogle ? "googleAdsSpend" : isMeta ? "metaAdsSpend" : "totalPaidAdSpend",
  )!;

  const spendSub = isGoogle
    ? "Search • Shopping • PMax"
    : isMeta
      ? "Feed • Stories • Advantage+"
      : "Combined Google + Meta";

  const bridgeTag = isGoogle
    ? "Store ➔ Google Customer Match"
    : isMeta
      ? "Store ➔ Meta Custom Audience Sync"
      : "Store ➔ Multi-Channel Growth Loop";

  const bridgeTagClass = isGoogle
    ? "diagnostic-tag diagnostic-tag--google"
    : isMeta
      ? "diagnostic-tag diagnostic-tag--meta"
      : "diagnostic-tag diagnostic-tag--verdant";

  const bridgeTitle = isGoogle
    ? "Store RFM Segments ➔ Google Customer Match & Negative Lists"
    : isMeta
      ? "Store RFM Segments ➔ Meta Custom Audiences & Lookalikes"
      : "RFM Cohort to Paid Audience Action Bridge";

  const bridgeDesc = isGoogle
    ? "Transforming customer lifecycle segments into Google Customer Match lists, Smart Bidding target cohorts, and negative audience exclusions."
    : isMeta
      ? "Transforming customer lifecycle segments into Meta 1% Lookalikes, Winback Custom Audiences, and 7-day buyer exclusions."
      : "Transforming customer lifecycle segments into actionable Meta Custom Audiences, Lookalikes, and exclusion filters.";

  return (
    <div className="diagnostic-section">
      {/* SECTION 1: TRUE BLENDED MER & ATTRIBUTION RECONCILIATION */}
      <section id="blended-mer" className="diagnostic-panel">
        <div className="diagnostic-panel__header">
          <div className="diagnostic-panel__heading">
            <span className={headerTagClass}>{headerTag}</span>
            <h2 className="diagnostic-panel__title">
              <span className="metric-label-inline">
                {sectionTitle}
                <MetricHint
                  label={isGoogle || isMeta ? "Store ROAS" : "Blended MER"}
                  text={kpiHint}
                />
              </span>
            </h2>
            <p className="diagnostic-panel__desc">{sectionDesc}</p>
          </div>

          <div className="diagnostic-kpi-card diagnostic-kpi-card--highlight">
            <span className="diagnostic-kpi-card__label metric-label-inline">
              {kpiLabel}
              <MetricHint label={kpiLabel} text={kpiHint} />
            </span>
            <span className={kpiValueClass}>{blendedMer.blendedMer.toFixed(2)}×</span>
          </div>
        </div>

        {/* METRICS COMPARISON GRID */}
        <div className="diagnostic-kpi-grid">
          <div className="diagnostic-kpi-card">
            <span className="diagnostic-kpi-card__label metric-label-inline">
              Store net sales
              <MetricHint label="Store net sales" text={metricHintFor("storeNetSales")!} />
            </span>
            <span className="diagnostic-kpi-card__val">
              {formatCurrency(blendedMer.storeNetSales, currency)}
            </span>
            <span className="diagnostic-kpi-card__sub diagnostic-kpi-card__sub--positive">
              Net sales recorded in the store
            </span>
          </div>

          <div className="diagnostic-kpi-card">
            <span className="diagnostic-kpi-card__label metric-label-inline">
              {spendLabel}
              <MetricHint label={spendLabel} text={spendHint} />
            </span>
            <span className="diagnostic-kpi-card__val">
              {formatCurrency(blendedMer.totalAdSpend, currency)}
            </span>
            <span className="diagnostic-kpi-card__sub">{spendSub}</span>
          </div>

          <div className="diagnostic-kpi-card">
            <span className="diagnostic-kpi-card__label metric-label-inline">
              Realized store orders
              <MetricHint
                label="Realized store orders"
                text={metricHintFor("realizedStoreOrders")!}
              />
            </span>
            <span className="diagnostic-kpi-card__val">{blendedMer.realStoreOrders} orders</span>
            <span className="diagnostic-kpi-card__sub">
              Realized CPA: <strong>{formatCurrency(blendedMer.blendedCpa, currency)}</strong>
            </span>
          </div>

          <div className="diagnostic-kpi-card">
            <span className="diagnostic-kpi-card__label metric-label-inline">
              Attributed-order overlap
              <MetricHint
                label="Attributed-order overlap"
                text={metricHintFor("attributionOverlapGap")!}
              />
            </span>
            <span className="diagnostic-kpi-card__val diagnostic-kpi-card__val--warning">
              +{blendedMer.overlapOrdersCount} orders ({blendedMer.attributionOverlapPercent}%)
            </span>
            <span className="diagnostic-kpi-card__sub">
              {blendedMer.claimedPlatformOrders} attributed vs {blendedMer.realStoreOrders} realized
            </span>
          </div>
        </div>

        {/* RECONCILIATION EXPLANATION NOTE */}
        <div className="diagnostic-callout">
          <SearchIcon className="diagnostic-callout__icon" />
          <div className="diagnostic-callout__content">
            <strong>Attribution reconciliation:</strong> {blendedMer.reconciliationNote}
          </div>
        </div>
      </section>

      {/* SECTION 2: RFM STORE COHORT TO PAID AUDIENCE BRIDGE */}
      <section id="audience-bridge" className="diagnostic-panel">
        <div className="diagnostic-panel__header">
          <div className="diagnostic-panel__heading">
            <span className={bridgeTagClass}>{bridgeTag}</span>
            <h2 className="diagnostic-panel__title">
              <span className="metric-label-inline">
                {bridgeTitle}
                <MetricHint label="RFM segments" text={metricHintFor("rfmSegments")!} />
              </span>
            </h2>
            <p className="diagnostic-panel__desc">{bridgeDesc}</p>
          </div>

          <div className="diagnostic-kpi-card diagnostic-kpi-card--highlight">
            <span className="diagnostic-kpi-card__label metric-label-inline">
              Actionable accounts
              <MetricHint
                label="Actionable accounts"
                text={metricHintFor("actionableAccounts")!}
              />
            </span>
            <span className="diagnostic-kpi-card__val diagnostic-kpi-card__val--positive">
              {rfmBridge.totalActionableAccounts}
            </span>
          </div>
        </div>

        {/* ACTION CARDS GRID */}
        <div className="rfm-bridge-grid">
          {rfmBridge.cards.map((card) => {
            const isDownloaded = downloadedCardId === card.id;

            // Tailor card title and budget context according to active platform
            const cardTitle = isGoogle
              ? card.title.replace(/Meta/g, "Google").replace(/Lookalike/g, "Customer Match")
              : isMeta
                ? card.title
                : card.title;

            const cardDesc = isGoogle
              ? card.strategicPurpose.replace(/Meta/g, "Google").replace(/Lookalike/g, "Customer Match")
              : card.strategicPurpose;

            // These segments are simulated, so the card offers no budget split:
            // a spend recommendation on modelled customers would read as advice.
            const exportBtnLabel = isGoogle
              ? `Export sample Google Match CSV (${card.customerCount})`
              : isMeta
                ? `Export sample Meta audience CSV (${card.customerCount})`
                : `Export sample audience CSV (${card.customerCount})`;

            return (
              <div key={card.id} className="rfm-action-card">
                <div className="rfm-action-card__body">
                  <div className="rfm-action-card__meta">
                    <span className="rfm-action-card__badge">{card.cohortLabel}</span>
                    <span className="rfm-action-card__count">{card.customerCount} customers</span>
                  </div>

                  <h3 className="rfm-action-card__title">{cardTitle}</h3>
                  <p className="rfm-action-card__desc">{cardDesc}</p>
                </div>

                <div className="rfm-action-card__footer">
                  <button
                    type="button"
                    onClick={() => handleExportAudience(card.id, card.exportFileName, card.cohortLabel)}
                    className="rfm-action-card__btn"
                  >
                    {isDownloaded ? (
                      <>
                        <CheckIcon /> CSV exported
                      </>
                    ) : (
                      <>
                        <DownloadIcon /> {exportBtnLabel}
                      </>
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* No budget-reallocation card: its uplift came from a fixed ROAS that
          contradicted the measured figures on the same page. A reallocation
          suggestion returns only when it can be computed from read data. */}
    </div>
  );
}
