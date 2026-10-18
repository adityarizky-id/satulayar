"use client";

import React, { useState } from "react";
import type {
  Currency,
  MetaCreativeFatigueAnalysis,
  MetaPlacementAnalysis,
} from "@/lib/dashboard/types";
import { formatCurrency } from "@/lib/dashboard/account-contract";
import {
  MetricHint,
  metricHintFor,
} from "@/components/dashboard/metric-hint";

interface MetaCreativeRadarProps {
  fatigue: MetaCreativeFatigueAnalysis;
  placements: MetaPlacementAnalysis | null;
  currency: Currency;
}

export function MetaCreativeRadar({
  fatigue,
  placements,
  currency,
}: MetaCreativeRadarProps) {
  const [selectedFormat, setSelectedFormat] = useState<"all" | "static" | "carousel" | "video_reels">("all");

  const filteredAds =
    selectedFormat === "all"
      ? fatigue.ads
      : fatigue.ads.filter((a) => a.format === selectedFormat);

  return (
    <div className="diagnostic-section">
      {/* SECTION 1: CREATIVE FATIGUE RADAR */}
      <section id="creative-fatigue" className="diagnostic-panel">
        <div className="diagnostic-panel__header">
          <div className="diagnostic-panel__heading">
            <span className="diagnostic-tag diagnostic-tag--meta">
              Meta decision system
            </span>
            <h2 className="diagnostic-panel__title">
              Creative fatigue and lifecycle radar
            </h2>
            <p className="diagnostic-panel__desc">
              Monitor frequency, declining CTR, and rising CPA to identify when a creative needs review, replacement, or iteration.
            </p>
          </div>

          <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
            <div className="diagnostic-kpi-card diagnostic-kpi-card--highlight" style={{ padding: "8px 14px", minWidth: "auto" }}>
              <span className="diagnostic-kpi-card__label metric-label-inline">
                Active-ad ceiling
                <MetricHint
                  label="Active-ad ceiling"
                  text={metricHintFor("adCountCeiling")!}
                />
              </span>
              <span className="diagnostic-kpi-card__val" style={{ fontSize: "16px", marginTop: "2px" }}>
                {fatigue.activeAdsCount} / {fatigue.adCeilingRecommended} max
              </span>
            </div>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              <span className="fatigue-pill fatigue-pill--healthy">
                ● {fatigue.healthyCount} Healthy
              </span>
              <span className="fatigue-pill fatigue-pill--warning">
                ▲ {fatigue.warningCount} Warning
              </span>
              <span className="fatigue-pill fatigue-pill--critical">
                ✖ {fatigue.criticalCount} Critical
              </span>
            </div>
          </div>
        </div>

        {/* FORMAT FILTER TABS */}
        <div style={{ display: "flex", gap: "8px", margin: "16px 0 12px 0", flexWrap: "wrap" }}>
          {(
            [
              { key: "all", label: "All Formats" },
              { key: "video_reels", label: "Video & Reels" },
              { key: "carousel", label: "Carousels" },
              { key: "static", label: "Statics" },
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setSelectedFormat(tab.key)}
              className="rfm-action-card__badge"
              style={{
                cursor: "pointer",
                background: selectedFormat === tab.key ? "var(--brand-meta-bg)" : "var(--surface-control)",
                color: selectedFormat === tab.key ? "var(--brand-meta-fg)" : "var(--text-secondary)",
                borderColor: selectedFormat === tab.key ? "var(--brand-meta-border)" : "var(--sl-border)",
                padding: "6px 12px",
                borderRadius: "8px",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* CREATIVE RADAR TABLE */}
        <div className="table-scroller">
          <table className="creative-radar-table">
            <caption className="visually-hidden">Active Meta creatives, delivery metrics and recommended actions</caption>
            <colgroup><col className="creative-radar-table__identity" /><col span={7} /><col className="creative-radar-table__action" /></colgroup>
            <thead>
              <tr>
                <th scope="col">Active Ad Creative</th>
                <th scope="col" style={{ textAlign: "right" }}>Frequency</th>
                <th scope="col" style={{ textAlign: "right" }}>CTR (7d Δ)</th>
                <th scope="col" style={{ textAlign: "right" }}>CPM (7d Δ)</th>
                <th scope="col" style={{ textAlign: "right" }}>Spend</th>
                <th scope="col" style={{ textAlign: "right" }}>Purchases</th>
                <th scope="col" style={{ textAlign: "right" }}>CPA</th>
                <th scope="col" style={{ textAlign: "right" }}>ROAS</th>
                <th scope="col">Action Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredAds.map((ad) => {
                const isHealthy = ad.fatigueStatus === "healthy";
                const isWarning = ad.fatigueStatus === "warning";

                return (
                  <tr key={ad.adId}>
                    <td>
                      <div style={{ fontWeight: 700, color: "var(--text-primary)" }}>
                        {ad.adName}
                      </div>
                      <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                        ID: {ad.adId} · {ad.format === "video_reels" ? "Video / Reels" : ad.format === "carousel" ? "Carousel" : "Static"} · {ad.daysActive} active {ad.daysActive === 1 ? "day" : "days"} in period
                      </div>
                    </td>
                    <td style={{ textAlign: "right", fontFamily: "var(--font-mono, monospace)", fontWeight: 800 }}>
                      <span
                        style={{
                          color:
                            ad.frequency > 3.5
                              ? "var(--status-negative-fg)"
                              : ad.frequency > 2.5
                                ? "var(--status-warning-fg)"
                                : "var(--text-primary)",
                        }}
                      >
                        {ad.frequency.toFixed(1)}×
                      </span>
                    </td>
                    <td style={{ textAlign: "right", fontFamily: "var(--font-mono, monospace)" }}>
                      <div>{ad.ctrCurrent.toFixed(2)}%</div>
                      <div
                        style={{
                          fontSize: "10.5px",
                          fontWeight: 700,
                          color:
                            ad.ctrDeltaVs7d >= 0
                              ? "var(--status-positive-fg)"
                              : ad.ctrDeltaVs7d < -20
                                ? "var(--status-negative-fg)"
                                : "var(--status-warning-fg)",
                        }}
                      >
                        {ad.ctrDeltaVs7d >= 0 ? "+" : ""}
                        {ad.ctrDeltaVs7d.toFixed(1)}%
                      </div>
                    </td>
                    <td style={{ textAlign: "right", fontFamily: "var(--font-mono, monospace)" }}>
                      <div>{formatCurrency(ad.cpmCurrent, currency)}</div>
                      <div
                        style={{
                          fontSize: "10.5px",
                          fontWeight: 700,
                          color:
                            ad.cpmDeltaVs7d > 20
                              ? "var(--status-negative-fg)"
                              : ad.cpmDeltaVs7d <= 0
                                ? "var(--status-positive-fg)"
                                : "var(--text-secondary)",
                        }}
                      >
                        {ad.cpmDeltaVs7d >= 0 ? "+" : ""}
                        {ad.cpmDeltaVs7d.toFixed(1)}%
                      </div>
                    </td>
                    <td style={{ textAlign: "right", fontFamily: "var(--font-mono, monospace)", fontWeight: 700, color: "var(--text-primary)" }}>
                      {formatCurrency(ad.spend, currency)}
                    </td>
                    <td style={{ textAlign: "right", fontFamily: "var(--font-mono, monospace)", fontWeight: 800, color: "var(--text-primary)" }}>
                      {ad.purchases}
                    </td>
                    <td style={{ textAlign: "right", fontFamily: "var(--font-mono, monospace)" }}>
                      {ad.costPerPurchase !== null
                        ? formatCurrency(ad.costPerPurchase, currency)
                        : "—"}
                    </td>
                    <td style={{ textAlign: "right", fontFamily: "var(--font-mono, monospace)", fontWeight: 700, color: "var(--text-primary)" }}>
                      {ad.roas !== null ? `${ad.roas.toFixed(1)}×` : "—"}
                    </td>
                    <td>
                      <div className="creative-radar-table__recommendation">
                        <span
                          className={`fatigue-pill ${
                            isHealthy
                              ? "fatigue-pill--healthy"
                              : isWarning
                                ? "fatigue-pill--warning"
                                : "fatigue-pill--critical"
                          }`}
                        >
                          {isHealthy ? "● Healthy" : isWarning ? "▲ Warning" : "✖ Critical"}
                        </span>
                        <span className="creative-radar-table__action-copy">
                          {ad.recommendedAction}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* VIDEO ENGAGEMENT METRICS BAR */}
        <div
          style={{
            marginTop: "20px",
            padding: "16px 20px",
            background: "var(--surface-control)",
            border: "1px solid var(--sl-border)",
            borderRadius: "12px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "18px" }}>🎬</span>
              <h3 style={{ margin: 0, fontSize: "13px", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.03em", color: "var(--text-primary)" }}>
                Video & Reels Retention Analysis
              </h3>
            </div>
            <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
              Avg Watch Time: <strong style={{ color: "var(--text-primary)" }}>{fatigue.videoEngagement.averageWatchTimeSec}s</strong>
            </span>
          </div>

          <div className="creative-retention-grid">
            <div style={{ background: "var(--surface-card)", border: "1px solid var(--sl-border)", borderRadius: "10px", padding: "14px" }}>
              <div className="creative-retention-grid__heading">
                <span style={{ color: "var(--text-secondary)", fontWeight: 600 }}>3-Second Hook Rate</span>
                <strong style={{ fontFamily: "var(--font-mono, monospace)", color: "var(--status-positive-fg)" }}>
                  {fatigue.videoEngagement.hookRate}% (Benchmark &gt; 25%)
                </strong>
              </div>
              <div className="retention-bar">
                <div
                  className="retention-bar__fill retention-bar__fill--green"
                  style={{ width: `${Math.min(100, fatigue.videoEngagement.hookRate * 3)}%` }}
                />
              </div>
              <p style={{ margin: 0, fontSize: "11px", color: "var(--text-muted)" }}>
                Proportion of viewers stopping thumb scroll in the first 3 seconds.
              </p>
            </div>

            <div style={{ background: "var(--surface-card)", border: "1px solid var(--sl-border)", borderRadius: "10px", padding: "14px" }}>
              <div className="creative-retention-grid__heading">
                <span style={{ color: "var(--text-secondary)", fontWeight: 600 }}>ThruPlay Hold Rate</span>
                <strong style={{ fontFamily: "var(--font-mono, monospace)", color: "var(--brand-meta-fg)" }}>
                  {fatigue.videoEngagement.holdRate}% (Benchmark &gt; 15%)
                </strong>
              </div>
              <div className="retention-bar">
                <div
                  className="retention-bar__fill retention-bar__fill--indigo"
                  style={{ width: `${Math.min(100, fatigue.videoEngagement.holdRate * 4)}%` }}
                />
              </div>
              <p style={{ margin: 0, fontSize: "11px", color: "var(--text-muted)" }}>
                Proportion of 3-sec viewers completing 15s or full video.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 2: PLACEMENT PERFORMANCE & WASTE */}
      {placements && (
        <section id="placement-performance" className="diagnostic-panel">
          <div className="diagnostic-panel__header">
            <div className="diagnostic-panel__heading">
              <span className="diagnostic-tag diagnostic-tag--meta">
                Placement Economics
              </span>
              <h2 className="diagnostic-panel__title">
                Placement Efficiency & Waste Filter
              </h2>
            </div>
            <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
              Top Driver: <strong style={{ color: "var(--text-primary)" }}>{placements.topPerformingPlacement}</strong>
            </div>
          </div>

          {placements.flaggedWasteAmount > 0 && (
            <div
              className="diagnostic-callout"
              style={{
                borderColor: "var(--status-negative-border)",
                background: "var(--status-negative-bg)",
                color: "var(--status-negative-fg)",
              }}
            >
              <span style={{ fontSize: "18px" }}>⚠️</span>
              <div>
                <strong>Placement Waste Alert:</strong> {placements.recommendation}
              </div>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "14px", marginTop: "18px" }}>
            {placements.placements.map((p) => {
              const isWaste = p.wasteStatus === "high_bounce_waste";
              const isOptimal = p.wasteStatus === "optimal";

              return (
                <div
                  key={p.placement}
                  style={{
                    background: isWaste ? "var(--status-negative-bg)" : "var(--surface-control)",
                    border: `1px solid ${isWaste ? "var(--status-negative-border)" : "var(--sl-border)"}`,
                    borderRadius: "12px",
                    padding: "14px",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--text-primary)" }}>
                      {p.label}
                    </span>
                    <span
                      style={{
                        padding: "2px 6px",
                        borderRadius: "4px",
                        fontSize: "10px",
                        fontWeight: 800,
                        background: isWaste ? "var(--status-negative-bg)" : isOptimal ? "var(--status-positive-bg)" : "var(--surface-card)",
                        color: isWaste ? "var(--status-negative-fg)" : isOptimal ? "var(--status-positive-fg)" : "var(--text-secondary)",
                      }}
                    >
                      {isWaste ? "Waste" : isOptimal ? "Optimal" : "Low Vol"}
                    </span>
                  </div>

                  <div style={{ marginTop: "12px", display: "flex", flexDirection: "column", gap: "6px", fontSize: "12px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", color: "var(--text-secondary)" }}>
                      <span>Spend ({p.spendSharePercent}%):</span>
                      <strong style={{ fontFamily: "var(--font-mono, monospace)", color: "var(--text-primary)" }}>
                        {formatCurrency(p.spend, currency)}
                      </strong>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", color: "var(--text-secondary)" }}>
                      <span>CTR:</span>
                      <span style={{ fontFamily: "var(--font-mono, monospace)", color: "var(--text-primary)" }}>{p.ctr.toFixed(2)}%</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", color: "var(--text-secondary)" }}>
                      <span>Purchases:</span>
                      <strong style={{ fontFamily: "var(--font-mono, monospace)", color: "var(--text-primary)" }}>{p.purchases}</strong>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", color: "var(--text-secondary)" }}>
                      <span>ROAS:</span>
                      <strong
                        style={{
                          fontFamily: "var(--font-mono, monospace)",
                          color: p.roas !== null && p.roas >= 3.0 ? "var(--status-positive-fg)" : p.roas !== null && p.roas > 0 ? "var(--text-primary)" : "var(--text-secondary)",
                        }}
                      >
                        {p.roas !== null && p.roas > 0 ? `${p.roas.toFixed(1)}×` : "0.0×"}
                      </strong>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
