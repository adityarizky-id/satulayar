"use client";

import { useEffect, useMemo, useState } from "react";

import { ChevronIcon } from "@/components/dashboard/icons";
import { paginate, Pagination } from "@/components/dashboard/pagination";
import { GoogleIntentSection } from "@/components/search/google-intent-section";
import {
  MATCH_TYPE_LABELS,
  type MatchType,
  type SearchTermAnalysis,
  type SearchTermRow,
} from "@/lib/dashboard/search-terms";
import type {
  Currency,
  GoogleIntentAnalysis,
  GoogleMatchTypeDriftSummary,
  GoogleWastedSpendSummary,
  Platform,
} from "@/lib/dashboard/types";

type SearchView = "leaks" | "keywords" | "intent" | "waste";

/**
 * The anchors the two merged panels used to own. They still exist as targets,
 * because the nav, saved links and the sidebar all pointed at them before the
 * panels became tabs here — and a link that scrolls to nothing is worse than
 * one that never existed. Landing on one selects its tab.
 */
const VIEW_ANCHORS: Record<string, SearchView> = {
  "intent-tiers": "intent",
  "wasted-spend": "waste",
};

const SEARCH_VIEW_COPY: Record<
  SearchView,
  { label: string; description: string }
> = {
  leaks: {
    label: "Leak hunt",
    description: "Find repeated words behind queries with the wrong buying intent.",
  },
  keywords: {
    label: "Keywords",
    description: "Compare keyword match types, efficiency, and conversion outcomes.",
  },
  intent: {
    label: "Intent tiers",
    description: "See how Search spend is distributed across four levels of buying intent.",
  },
  waste: {
    label: "Waste & negatives",
    description: "Review recoverable spend, negative-keyword candidates, and query drift.",
  },
};

const RELEVANCE_LABEL: Record<string, string> = {
  relevant: "relevant",
  review: "needs a look",
  irrelevant: "wrong intent",
};

/** Column definitions stay available to pointer and assistive-technology users. */
const COLUMN_HELP: Record<string, string> = {
  Keyword: "The word or phrase you bid on. You choose these.",
  Match:
    "How closely someone's search must resemble your keyword before Google shows the ad. Exact means the same meaning, Phrase means it contains that meaning, Broad means anything Google judges related — Broad reaches furthest and leaks most.",
  Queries:
    "How many different things people actually typed that this one keyword matched during the period.",
  "Search term": "What a person actually typed into Google.",
  "Matched keyword": "The keyword you bid on that let this search through.",
  Spend: "Money spent in the account's own currency, never converted.",
  Clicks: "Clicks on the ad.",
  CTR: "Clicks divided by impressions: how often being seen turns into a visit.",
  "Regist.": "Registrations, the first conversion step before an order.",
  Orders: "Purchases attributed by the platform.",
  CPO: "Cost per order: spend divided by orders. Blank when there are no orders to divide by.",
  "Wrong intent":
    "Spend sitting on searches whose wording suggests the person wants something you do not sell — a job, a tutorial, a single item. Flagged by rule, never removed automatically.",
  Verdict:
    "Whether the keyword gave anything back. 'Nothing back' means it spent more than one order should cost and produced neither an order nor a registration. 'Declining' means it still converts but has fallen by at least 30% against the comparison window. 'Too early' means it has not yet spent the price of one order.",
  Relevance:
    "Whether the wording of the search suggests the right intent. Hover the tag itself to read why it was flagged and who decided.",
};

const rangeFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

function formatRangeDate(value: string): string {
  return rangeFormatter.format(new Date(`${value}T12:00:00Z`));
}

function HeaderCell({ label }: { label: string }) {
  const help = COLUMN_HELP[label];
  return (
    <th aria-label={help ? `${label}: ${help}` : label} scope="col" title={help}>
      {help ? <span className="th-help">{label}</span> : label}
    </th>
  );
}

const LEAK_PAGE_SIZE = 10;
const KEYWORD_PAGE_SIZE = 15;
const TERM_PAGE_SIZE = 10;

const KEYWORD_COLUMNS = [
  "Keyword",
  "Match",
  "Queries",
  "Spend",
  "Clicks",
  "CTR",
  "Regist.",
  "Orders",
  "CPO",
  "Wrong intent",
  "Verdict",
];

const TERM_COLUMNS = [
  "Search term",
  "Matched keyword",
  "Match",
  "Spend",
  "Clicks",
  "Regist.",
  "Orders",
  "Relevance",
];

const WASTE_LABEL: Record<string, string> = {
  "spending-nothing-back": "nothing back",
  declining: "declining",
  healthy: "converting",
  "too-early": "too early",
  "not-measured": "not measured",
};

export function SearchTermSection({
  analysis,
  intent,
  matchTypeDrift,
  currency,
  selectedPlatform,
  wastedSpend,
}: {
  analysis: SearchTermAnalysis | null;
  intent: GoogleIntentAnalysis | null;
  matchTypeDrift: GoogleMatchTypeDriftSummary | null;
  currency: Currency;
  selectedPlatform: Platform;
  wastedSpend: GoogleWastedSpendSummary | null;
}) {
  const [openToken, setOpenToken] = useState<string | null>(null);
  const [matchFilter, setMatchFilter] = useState<MatchType | "all">("all");
  const [view, setView] = useState<SearchView>("leaks");
  const [leakPage, setLeakPage] = useState(0);
  const [keywordPage, setKeywordPage] = useState(0);
  const [termPage, setTermPage] = useState(0);

  useEffect(() => {
    const applyHash = () => {
      const target = VIEW_ANCHORS[window.location.hash.replace("#", "")];
      if (target) setView(target);
    };

    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, []);

  const currencyFormatter = useMemo(
    () =>
      new Intl.NumberFormat("en-GB", {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
      }),
    [currency],
  );
  const numberFormatter = useMemo(
    () => new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }),
    [],
  );
  const compactFormatter = useMemo(
    () =>
      new Intl.NumberFormat("en-GB", {
        notation: "compact",
        maximumFractionDigits: 1,
      }),
    [],
  );

  if (!analysis) return null;

  const keywords =
    matchFilter === "all"
      ? analysis.keywords
      : analysis.keywords.filter((row) => row.matchType === matchFilter);

  // The leak view ranks shared words by the spend behind the queries the rules
  // flagged, because that is the money a single negative keyword would stop.
  const leakGroups = analysis.ngrams.filter(
    (group) => group.irrelevantTerms > 0 || group.reviewTerms > 0,
  );
  const leakPageState = paginate(leakGroups, leakPage, LEAK_PAGE_SIZE);
  const keywordPageState = paginate(keywords, keywordPage, KEYWORD_PAGE_SIZE);
  const viewCounts: Record<SearchView, number | null> = {
    leaks: leakGroups.length,
    keywords: analysis.keywords.length,
    intent: intent?.queryCount ?? null,
    waste: wastedSpend?.flaggedQueryCount ?? null,
  };
  const availableViews: Record<SearchView, boolean> = {
    leaks: true,
    keywords: true,
    intent: intent !== null,
    waste: wastedSpend !== null,
  };
  const showQuerySummary = view === "leaks" || view === "keywords";
  const displayedRange = showQuerySummary
    ? analysis.comparisonRange
    : analysis.range;

  return (
    <section className="section" id="search-terms">
      {analysis.dataOrigin === "synthetic-illustration" && (
        <div
          className="console-notice console-notice--warning"
          role="note"
          data-origin="synthetic-illustration"
        >
          <div>
            <strong>Synthetic illustration · under development</strong>
            <p>
              These keywords, search queries and figures are invented examples
              scaled from Google spend. They are not read from the search terms
              report. Do not add negatives or change match types from them.
            </p>
          </div>
        </div>
      )}
      {/* Always rendered, so the retired anchors still have somewhere to land
          however the tabs are switched. */}
      <span aria-hidden="true" className="anchor-target" id="intent-tiers" />
      <span aria-hidden="true" className="anchor-target" id="wasted-spend" />

      <div className="section-heading">
        <div>
          <span className="eyebrow">Account diagnostic</span>
          <h2>
            Search terms and keywords
            {selectedPlatform === "all" && (
              <span className="metric-tag metric-tag--google">
                Google Ads only
              </span>
            )}
          </h2>
        </div>
        <p>
          Trace query quality from repeated leak patterns to buying intent and
          negative-keyword actions. Every recommendation stays review-only —
          the rules propose, you decide.
        </p>
      </div>

      <div className="search-controls">
        <div
          className="search-view-switcher"
          role="group"
          aria-label="Search analysis view"
        >
          {(Object.keys(SEARCH_VIEW_COPY) as SearchView[]).map((option) => {
            const isActive = view === option;
            const count = viewCounts[option];
            return (
              <button
                aria-pressed={isActive}
                className={`search-view-switcher__button${isActive ? " search-view-switcher__button--active" : ""}`}
                disabled={!availableViews[option]}
                key={option}
                onClick={() => {
                  setView(option);
                  if (option === "leaks") setLeakPage(0);
                  if (option === "keywords") setKeywordPage(0);
                }}
                type="button"
              >
                <span>{SEARCH_VIEW_COPY[option].label}</span>
                {count === null ? <em>Pending</em> : <strong>{count}</strong>}
              </button>
            );
          })}
        </div>

        <span className="search-controls__range">
          <small>{showQuerySummary ? "Comparison period" : "Analysis period"}</small>
          <b>
            {formatRangeDate(displayedRange.start)} →{" "}
            {formatRangeDate(displayedRange.end)}
          </b>
        </span>
      </div>

      <p className="search-view-intro" aria-live="polite">
        {SEARCH_VIEW_COPY[view].description}
      </p>

      {showQuerySummary && (
        <div className="match-summary">
          {analysis.matchTypes.map((summary) => (
            <article
              className={`match-card${
                summary.irrelevantSpendShare > 0.15 ? " match-card--leaky" : ""
              }`}
              key={summary.matchType}
            >
              <header>
                <strong>{summary.label}</strong>
                <span>
                  {summary.keywords} keyword{summary.keywords === 1 ? "" : "s"}
                </span>
              </header>
              <dl>
                <div>
                  <dt>Spend</dt>
                  <dd>{currencyFormatter.format(summary.spend)}</dd>
                </div>
                <div>
                  <dt>Orders</dt>
                  <dd>{numberFormatter.format(summary.purchases)}</dd>
                </div>
                <div>
                  <dt>CPO</dt>
                  <dd>
                    {summary.costPerPurchase === null
                      ? "N/A"
                      : currencyFormatter.format(summary.costPerPurchase)}
                  </dd>
                </div>
                <div>
                  <dt>Wrong intent</dt>
                  <dd
                    className={
                      summary.irrelevantSpendShare > 0.15 ? "cell--breach" : undefined
                    }
                  >
                    {Math.round(summary.irrelevantSpendShare * 100)}%
                  </dd>
                </div>
              </dl>
              <p>{summary.safeMessage}</p>
            </article>
          ))}
        </div>
      )}

      {showQuerySummary && analysis.totals.belowThresholdSpend > 0 && (
        <p className="geo-unattributed">
          <strong>
            {currencyFormatter.format(analysis.totals.belowThresholdSpend)}
          </strong>{" "}
          of Search spend sits on queries Google withheld for falling below its
          reporting threshold. The terms below are not the whole account.
        </p>
      )}

      {view === "leaks" ? (
        <>
        <div className="leak-list">
          {leakGroups.length === 0 ? (
            <div className="search-empty">
              <span className="search-empty__signal" aria-hidden="true" />
              <span className="search-empty__copy">
                <strong>No repeated leak pattern found</strong>
                <small>
                  Live data is available: {analysis.keywords.length} keyword
                  {analysis.keywords.length === 1 ? "" : "s"} across{" "}
                  {analysis.rows.length} query and keyword pair
                  {analysis.rows.length === 1 ? "" : "s"}. Leak hunt only
                  shows words shared by at least two flagged queries.
                </small>
              </span>
              <button
                className="search-empty__action"
                onClick={() => {
                  setView("keywords");
                  setKeywordPage(0);
                }}
                type="button"
              >
                View {analysis.keywords.length} keyword
                {analysis.keywords.length === 1 ? "" : "s"}
              </button>
            </div>
          ) : (
            leakPageState.rows.map((group) => {
              const isOpen = openToken === group.token;
              // A group can now reach this list on review spend alone — several
              // queries sharing a word, each spending past the cost of an order
              // without converting, none of them flagged by wording. Reading
              // that group as "0% flagged" would hide exactly what it is.
              const flaggedOnly = group.irrelevantTerms === 0;
              const headlineSpend = flaggedOnly
                ? group.reviewSpend
                : group.flaggedSpend;
              const flaggedRatio =
                group.spend === 0 ? 0 : headlineSpend / group.spend;

              return (
                <article
                  className={`leak-card${isOpen ? " leak-card--open" : ""}`}
                  key={group.token}
                >
                  <button
                    aria-expanded={isOpen}
                    className="leak-card__bar"
                    onClick={() => {
                      setOpenToken(isOpen ? null : group.token);
                      setTermPage(0);
                    }}
                    type="button"
                  >
                    <span className="leak-card__identity">
                      <b>“{group.token}”</b>
                      <small>
                        {flaggedOnly
                          ? `${group.reviewTerms} of ${group.terms} queries spent without converting`
                          : `${group.irrelevantTerms} of ${group.terms} queries flagged`}
                      </small>
                      {/* The share of this word's spend that is flagged, so a
                          big word with one bad query does not look like a leak. */}
                      <span className="leak-card__ratio">
                        <i style={{ width: `${flaggedRatio * 100}%` }} />
                      </span>
                    </span>

                    <span className="leak-stats">
                      <span>
                        <dt>Impr.</dt>
                        <dd>{compactFormatter.format(group.impressions)}</dd>
                      </span>
                      <span>
                        <dt>Clicks</dt>
                        <dd>{compactFormatter.format(group.clicks)}</dd>
                      </span>
                      <span>
                        <dt>CTR</dt>
                        <dd>
                          {group.ctr === null
                            ? "N/A"
                            : `${(group.ctr * 100).toFixed(2)}%`}
                        </dd>
                      </span>
                      <span>
                        <dt>Spend</dt>
                        <dd>{currencyFormatter.format(group.spend)}</dd>
                      </span>
                      <span>
                        <dt>Orders</dt>
                        <dd>{numberFormatter.format(group.purchases)}</dd>
                      </span>
                    </span>

                    <span className="leak-card__spend">
                      <b>{currencyFormatter.format(headlineSpend)}</b>
                      <em>
                        {Math.round(flaggedRatio * 100)}%{" "}
                        {flaggedOnly ? "needs a look" : "flagged"}
                      </em>
                    </span>
                    <span className="type-card__caret" aria-hidden="true">
                      <ChevronIcon />
                    </span>
                  </button>

                  {isOpen && (
                    <TermTable
                      currencyFormatter={currencyFormatter}
                      numberFormatter={numberFormatter}
                      onPageChange={setTermPage}
                      page={termPage}
                      rows={group.rows}
                    />
                  )}
                </article>
              );
            })
          )}
        </div>
        <Pagination
          itemNoun="shared word"
          onChange={setLeakPage}
          page={leakPageState.safePage}
          pageCount={leakPageState.pageCount}
          pageSize={LEAK_PAGE_SIZE}
          totalItems={leakGroups.length}
        />
        </>
      ) : view === "keywords" ? (
        <>
          <div className="geo-filter-chips" role="group" aria-label="Match type">
            <button
              aria-pressed={matchFilter === "all"}
              className={matchFilter === "all" ? "is-active" : undefined}
              onClick={() => {
                setMatchFilter("all");
                setKeywordPage(0);
              }}
              type="button"
            >
              All <b>{analysis.keywords.length}</b>
            </button>
            {(["exact", "phrase", "broad"] as MatchType[]).map((matchType) => {
              const count = analysis.keywords.filter(
                (row) => row.matchType === matchType,
              ).length;
              if (count === 0) return null;
              return (
                <button
                  aria-pressed={matchFilter === matchType}
                  className={matchFilter === matchType ? "is-active" : undefined}
                  key={matchType}
                  onClick={() => {
                    setMatchFilter(matchType);
                    setKeywordPage(0);
                  }}
                  type="button"
                >
                  {MATCH_TYPE_LABELS[matchType]} <b>{count}</b>
                </button>
              );
            })}
          </div>

          <div
            aria-label="Keyword performance table"
            className="table-scroller"
            role="region"
            tabIndex={0}
          >
            <table>
              <caption className="visually-hidden">
                Keywords with match type, spend, and conversion performance
              </caption>
              <thead>
                <tr>
                  {KEYWORD_COLUMNS.map((column) => (
                    <HeaderCell key={column} label={column} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {keywordPageState.rows.map((row) => (
                  <tr key={`${row.keyword}-${row.matchType}`}>
                    <th scope="row">{row.keyword}</th>
                    <td>
                      <span className={`match-pill match-pill--${row.matchType}`}>
                        {MATCH_TYPE_LABELS[row.matchType]}
                      </span>
                    </td>
                    <td>{row.terms}</td>
                    <td>{currencyFormatter.format(row.spend)}</td>
                    <td>{numberFormatter.format(row.clicks)}</td>
                    <td>
                      {row.ctr === null ? "N/A" : `${(row.ctr * 100).toFixed(2)}%`}
                    </td>
                    <td>{numberFormatter.format(row.registrations)}</td>
                    <td>{numberFormatter.format(row.purchases)}</td>
                    <td>
                      {row.costPerPurchase === null
                        ? "N/A"
                        : currencyFormatter.format(row.costPerPurchase)}
                    </td>
                    <td
                      className={row.irrelevantSpend > 0 ? "cell--breach" : undefined}
                    >
                      {row.irrelevantSpend === 0
                        ? "—"
                        : currencyFormatter.format(row.irrelevantSpend)}
                    </td>
                    <td>
                      <span
                        className={`waste-chip waste-chip--${row.waste.level}`}
                        title={row.waste.safeMessage}
                      >
                        {WASTE_LABEL[row.waste.level]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            itemNoun="keyword"
            onChange={setKeywordPage}
            page={keywordPageState.safePage}
            pageCount={keywordPageState.pageCount}
            pageSize={KEYWORD_PAGE_SIZE}
            totalItems={keywords.length}
          />
        </>
      ) : view === "intent" && intent ? (
        <GoogleIntentSection
          currency={currency}
          intent={intent}
          matchTypeDrift={matchTypeDrift}
          view="intent"
          wastedSpend={wastedSpend}
        />
      ) : view === "waste" && wastedSpend ? (
        <GoogleIntentSection
          currency={currency}
          intent={intent}
          matchTypeDrift={matchTypeDrift}
          view="waste"
          wastedSpend={wastedSpend}
        />
      ) : null}

      <details className="panel card-notes">
        <summary>Search reporting notes</summary>
        <p>{analysis.safeMessage}</p>
      </details>
    </section>
  );
}

function TermTable({
  rows,
  currencyFormatter,
  numberFormatter,
  page,
  onPageChange,
}: {
  rows: SearchTermRow[];
  currencyFormatter: Intl.NumberFormat;
  numberFormatter: Intl.NumberFormat;
  page: number;
  onPageChange: (page: number) => void;
}) {
  // A single shared word can gather hundreds of queries once real data lands.
  const { rows: pageRows, safePage, pageCount } = paginate(
    rows,
    page,
    TERM_PAGE_SIZE,
  );

  return (
    <>
    <div
      aria-label="Search query detail table"
      className="table-scroller"
      role="region"
      tabIndex={0}
    >
      <table>
        <caption className="visually-hidden">
          Search queries sharing this word, with the keyword that matched them
        </caption>
        <thead>
          <tr>
            {TERM_COLUMNS.map((column) => (
              <HeaderCell key={column} label={column} />
            ))}
          </tr>
        </thead>
        <tbody>
          {pageRows.map((row) => (
            <tr key={row.id}>
              <th scope="row">{row.term}</th>
              <td>{row.keyword}</td>
              <td>
                <span className={`match-pill match-pill--${row.keywordMatchType}`}>
                  {MATCH_TYPE_LABELS[row.keywordMatchType]}
                </span>
              </td>
              <td>{currencyFormatter.format(row.spend)}</td>
              <td>{numberFormatter.format(row.clicks)}</td>
              <td>{numberFormatter.format(row.registrations)}</td>
              <td>{numberFormatter.format(row.purchases)}</td>
              <td>
                {/* The reason travels with the verdict: a flag the reader
                    cannot interrogate is a flag they cannot act on. */}
                <span
                  className={`relevance-chip relevance-chip--${row.relevance.verdict}`}
                  title={`${row.relevance.reason} (${
                    row.relevance.source === "agent" ? "AI agent" : "rule-based"
                  })`}
                >
                  {RELEVANCE_LABEL[row.relevance.verdict]}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <Pagination
      itemNoun="query"
      onChange={onPageChange}
      page={safePage}
      pageCount={pageCount}
      pageSize={TERM_PAGE_SIZE}
      totalItems={rows.length}
    />
    </>
  );
}
