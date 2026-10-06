/**
 * Deterministic search-intent classification for retail and reseller accounts. The
 * rules are deliberately inspectable: no query text leaves the application and
 * every verdict carries the n-grams that produced it.
 *
 * The lexicon is per market. An English-only lexicon read an Indonesian or Malay
 * account as almost pure early-stage research, because nothing matched and the
 * fallback tier absorbed every query — a confident answer built on no signal.
 * `classified` now says whether any rule fired at all, so a caller can report
 * the gap instead of publishing the fallback as a finding.
 */

export type IntentTier =
  | "brand_intent"
  | "high_commercial"
  | "informational_consideration"
  | "low_intent_irrelevant";

export type NgramSize = 1 | 2;

export interface QueryNgram {
  value: string;
  size: NgramSize;
  /** Zero-based word position in the normalized query. */
  start: number;
}

export interface IntentSignal {
  tier: IntentTier;
  pattern: string;
  weight: number;
  reason: string;
}

export interface IntentClassification {
  query: string;
  normalizedQuery: string;
  tier: IntentTier;
  label: string;
  /**
   * False when no rule fired and `tier` is only the fallback. Spend behind an
   * unclassified query is real and must be reported as unclassified, never
   * folded into a tier as though a rule had chosen it.
   */
  classified: boolean;
  /** 0..1. Based on the winning score's margin over the runner-up. */
  confidence: number;
  scores: Record<IntentTier, number>;
  tokens: string[];
  ngrams: QueryNgram[];
  signals: IntentSignal[];
}

export interface LabelledIntentQuery {
  query: string;
  expectedTier: IntentTier;
}

export interface IntentClassifierEvaluation {
  total: number;
  correct: number;
  accuracy: number | null;
  confusionMatrix: Record<IntentTier, Record<IntentTier, number>>;
}

export const INTENT_TIER_LABELS: Record<IntentTier, string> = {
  brand_intent: "Brand intent",
  high_commercial: "High commercial / buy intent",
  informational_consideration: "Informational / consideration",
  low_intent_irrelevant: "Low intent / irrelevant",
};

interface LexiconRule {
  tier: IntentTier;
  pattern: string;
  weight: number;
  reason: string;
}

/**
 * The market a query is read in. Brand aliases are not part of it: two brands
 * can share a market, and one brand can run in several.
 */
export type IntentMarket = "en" | "id" | "ms";

/**
 * Brand aliases per account slug, normalised the same way a query is. They are
 * injected rather than written into the lexicon, because a brand term that is
 * hardcoded into the shared rules classifies one account correctly and leaves
 * every other account without brand detection at all — which then inflates the
 * non-brand ladder with brand traffic.
 *
 * House brands can be shared across storefronts. Add a storefront's own
 * aliases here when the operator confirms them; never guess a brand name.
 */
export interface BrandAlias {
  /** Written as a person would type it; normalised when the profile resolves. */
  alias: string;
  /**
   * How strongly the alias alone identifies the brand, on the same scale as the
   * lexicon. A compact alias that cannot occur by accident — `kopisenja` —
   * has to outrank the commercial modifiers that share its query, or
   * "kopisenja trade account" is filed as generic trade demand. A first name
   * that could be coincidental is weighted well below that.
   */
  weight: number;
}

/**
 * The house brand several storefronts share. A storefront's own aliases are
 * added to its entry when the operator confirms them; a brand name is never
 * guessed, because a wrong alias moves real non-brand spend out of the ladder.
 */
const HOUSE_BRAND: readonly BrandAlias[] = [
  { alias: "rumahnusantara", weight: 12 },
  { alias: "rumah nusantara", weight: 9 },
];

export const ACCOUNT_BRAND_TERMS: Record<string, readonly BrandAlias[]> = {
  "kopi-senja": [
    { alias: "kopisenja", weight: 12 },
    { alias: "kopi senja", weight: 9 },
    { alias: "senja", weight: 5 },
  ],
  "batik-lestari": HOUSE_BRAND,
  "rumah-rajut": HOUSE_BRAND,
  "jamu-alami": HOUSE_BRAND,
  "kriya-bali": HOUSE_BRAND,
};

/** The market each account sells into, for lexicon selection. */
export const ACCOUNT_MARKETS: Record<string, IntentMarket> = {
  "kopi-senja": "id",
  "batik-lestari": "id",
  "rumah-rajut": "id",
  "jamu-alami": "id",
  "kriya-bali": "id",
};

export interface IntentProfile {
  market: IntentMarket;
  /** Already normalised brand aliases; unigrams and bigrams only. */
  brandTerms: readonly BrandAlias[];
}

export const DEFAULT_INTENT_PROFILE: IntentProfile = {
  market: "en",
  brandTerms: [],
};

/**
 * The profile for an account slug. An unknown slug gets the English lexicon and
 * no brand terms, so brand traffic lands in the unclassified bucket and is
 * visible, rather than being silently counted as non-brand demand.
 */
export function resolveIntentProfile(
  accountSlug?: string | null,
): IntentProfile {
  if (!accountSlug) return DEFAULT_INTENT_PROFILE;
  return {
    market: ACCOUNT_MARKETS[accountSlug] ?? "en",
    brandTerms: (ACCOUNT_BRAND_TERMS[accountSlug] ?? []).map((entry) => ({
      alias: normalizeSearchQuery(entry.alias),
      weight: entry.weight,
    })),
  };
}

const LEXICON: readonly LexiconRule[] = [
  { tier: "high_commercial", pattern: "wholesale", weight: 6, reason: "explicit wholesale demand" },
  { tier: "high_commercial", pattern: "wholesaler", weight: 6, reason: "searches for a wholesaler" },
  { tier: "high_commercial", pattern: "bulk", weight: 5, reason: "explicit bulk demand" },
  { tier: "high_commercial", pattern: "trade", weight: 4, reason: "explicit trade demand" },
  { tier: "high_commercial", pattern: "supplier", weight: 5, reason: "supplier-selection intent" },
  { tier: "high_commercial", pattern: "suppliers", weight: 5, reason: "supplier-selection intent" },
  { tier: "high_commercial", pattern: "distributor", weight: 5, reason: "distribution intent" },
  { tier: "high_commercial", pattern: "b2b", weight: 6, reason: "explicit business buying intent" },
  { tier: "high_commercial", pattern: "stockist", weight: 5, reason: "stockist intent" },
  { tier: "high_commercial", pattern: "dropship", weight: 5, reason: "dropship supply intent" },
  { tier: "high_commercial", pattern: "pallet", weight: 4, reason: "bulk logistics intent" },
  { tier: "high_commercial", pattern: "buy", weight: 3, reason: "purchase verb" },
  { tier: "high_commercial", pattern: "trade account", weight: 7, reason: "trade-account intent" },
  { tier: "high_commercial", pattern: "buy wholesale", weight: 8, reason: "explicit wholesale purchase intent" },
  { tier: "high_commercial", pattern: "bulk buy", weight: 7, reason: "explicit bulk purchase intent" },
  { tier: "high_commercial", pattern: "minimum order", weight: 5, reason: "checks a wholesale order constraint" },

  { tier: "informational_consideration", pattern: "how to", weight: 7, reason: "how-to research" },
  { tier: "informational_consideration", pattern: "what is", weight: 7, reason: "definition research" },
  { tier: "informational_consideration", pattern: "guide", weight: 6, reason: "guide-seeking research" },
  { tier: "informational_consideration", pattern: "tutorial", weight: 7, reason: "tutorial intent" },
  { tier: "informational_consideration", pattern: "recipe", weight: 6, reason: "recipe research" },
  { tier: "informational_consideration", pattern: "ideas", weight: 5, reason: "idea exploration" },
  { tier: "informational_consideration", pattern: "meaning", weight: 6, reason: "definition research" },
  { tier: "informational_consideration", pattern: "benefits", weight: 4, reason: "benefit research" },
  { tier: "informational_consideration", pattern: "difference", weight: 5, reason: "comparison research" },
  { tier: "informational_consideration", pattern: "best", weight: 3, reason: "category consideration" },

  { tier: "low_intent_irrelevant", pattern: "job", weight: 8, reason: "employment intent" },
  { tier: "low_intent_irrelevant", pattern: "jobs", weight: 8, reason: "employment intent" },
  { tier: "low_intent_irrelevant", pattern: "vacancy", weight: 8, reason: "employment intent" },
  { tier: "low_intent_irrelevant", pattern: "salary", weight: 8, reason: "employment intent" },
  { tier: "low_intent_irrelevant", pattern: "career", weight: 7, reason: "employment intent" },
  { tier: "low_intent_irrelevant", pattern: "free", weight: 7, reason: "free-resource intent" },
  { tier: "low_intent_irrelevant", pattern: "diy", weight: 7, reason: "do-it-yourself intent" },
  { tier: "low_intent_irrelevant", pattern: "homemade", weight: 6, reason: "home-production intent" },
  { tier: "low_intent_irrelevant", pattern: "amazon", weight: 6, reason: "consumer marketplace intent" },
  { tier: "low_intent_irrelevant", pattern: "ebay", weight: 6, reason: "consumer/second-hand marketplace intent" },
  { tier: "low_intent_irrelevant", pattern: "etsy", weight: 5, reason: "consumer marketplace intent" },
  { tier: "low_intent_irrelevant", pattern: "used", weight: 4, reason: "second-hand intent" },
  { tier: "low_intent_irrelevant", pattern: "personal", weight: 5, reason: "personal-use intent" },
  { tier: "low_intent_irrelevant", pattern: "single piece", weight: 7, reason: "single-unit retail intent" },
  { tier: "low_intent_irrelevant", pattern: "second hand", weight: 7, reason: "second-hand intent" },
  { tier: "low_intent_irrelevant", pattern: "school project", weight: 8, reason: "school-project intent" },
] as const;

/**
 * Market lexicons. Every pattern is written in its normalised form, because
 * that is what it is matched against. The English lexicon above always applies
 * too: Indonesian shoppers type "supplier", "reseller" and "wholesale" as often
 * as the local words.
 *
 * Marketplaces and classifieds carry as much signal as a wording rule — a query
 * naming Shopee, Tokopedia or OLX is shopping a marketplace listing, not the
 * brand's own store.
 */
const MARKET_LEXICONS: Record<IntentMarket, readonly LexiconRule[]> = {
  en: [],
  id: [
    { tier: "high_commercial", pattern: "grosir", weight: 6, reason: "explicit wholesale demand" },
    { tier: "high_commercial", pattern: "harga grosir", weight: 7, reason: "checks a wholesale price" },
    { tier: "high_commercial", pattern: "partai besar", weight: 6, reason: "explicit bulk demand" },
    { tier: "high_commercial", pattern: "pemasok", weight: 5, reason: "supplier-selection intent" },
    { tier: "high_commercial", pattern: "agen", weight: 4, reason: "reseller-agent intent" },
    { tier: "high_commercial", pattern: "beli", weight: 3, reason: "purchase verb" },
    { tier: "high_commercial", pattern: "pesan", weight: 3, reason: "order verb" },
    { tier: "high_commercial", pattern: "minimal order", weight: 5, reason: "checks a wholesale order constraint" },
    { tier: "informational_consideration", pattern: "cara", weight: 6, reason: "how-to research" },
    { tier: "informational_consideration", pattern: "cara membuat", weight: 7, reason: "how-to research" },
    { tier: "informational_consideration", pattern: "apa itu", weight: 7, reason: "definition research" },
    { tier: "informational_consideration", pattern: "panduan", weight: 6, reason: "guide-seeking research" },
    { tier: "informational_consideration", pattern: "resep", weight: 6, reason: "recipe research" },
    { tier: "informational_consideration", pattern: "manfaat", weight: 5, reason: "benefit research" },
    { tier: "informational_consideration", pattern: "perbedaan", weight: 5, reason: "comparison research" },
    { tier: "low_intent_irrelevant", pattern: "lowongan", weight: 8, reason: "employment intent" },
    { tier: "low_intent_irrelevant", pattern: "loker", weight: 8, reason: "employment intent" },
    { tier: "low_intent_irrelevant", pattern: "gaji", weight: 8, reason: "employment intent" },
    { tier: "low_intent_irrelevant", pattern: "gratis", weight: 7, reason: "free-resource intent" },
    { tier: "low_intent_irrelevant", pattern: "bekas", weight: 6, reason: "second-hand intent" },
    { tier: "low_intent_irrelevant", pattern: "bikin sendiri", weight: 7, reason: "do-it-yourself intent" },
    { tier: "low_intent_irrelevant", pattern: "tugas sekolah", weight: 8, reason: "school-project intent" },
    { tier: "low_intent_irrelevant", pattern: "shopee", weight: 6, reason: "consumer marketplace intent" },
    { tier: "low_intent_irrelevant", pattern: "tokopedia", weight: 6, reason: "consumer marketplace intent" },
    { tier: "low_intent_irrelevant", pattern: "olx", weight: 7, reason: "consumer classifieds intent" },
  ],
  ms: [
    { tier: "high_commercial", pattern: "borong", weight: 6, reason: "explicit wholesale demand" },
    { tier: "high_commercial", pattern: "harga borong", weight: 7, reason: "checks a wholesale price" },
    { tier: "high_commercial", pattern: "pembekal", weight: 5, reason: "supplier-selection intent" },
    { tier: "high_commercial", pattern: "beli", weight: 3, reason: "purchase verb" },
    { tier: "informational_consideration", pattern: "cara", weight: 6, reason: "how-to research" },
    { tier: "informational_consideration", pattern: "apa itu", weight: 7, reason: "definition research" },
    { tier: "informational_consideration", pattern: "resipi", weight: 6, reason: "recipe research" },
    { tier: "informational_consideration", pattern: "perbezaan", weight: 5, reason: "comparison research" },
    { tier: "low_intent_irrelevant", pattern: "kerja kosong", weight: 8, reason: "employment intent" },
    { tier: "low_intent_irrelevant", pattern: "gaji", weight: 8, reason: "employment intent" },
    { tier: "low_intent_irrelevant", pattern: "percuma", weight: 7, reason: "free-resource intent" },
    { tier: "low_intent_irrelevant", pattern: "terpakai", weight: 6, reason: "second-hand intent" },
    { tier: "low_intent_irrelevant", pattern: "lazada", weight: 6, reason: "consumer marketplace intent" },
    { tier: "low_intent_irrelevant", pattern: "carousell", weight: 6, reason: "consumer classifieds intent" },
  ],
};

const TIER_ORDER: readonly IntentTier[] = [
  "low_intent_irrelevant",
  "brand_intent",
  "high_commercial",
  "informational_consideration",
];

/**
 * Letters NFKD does not decompose. Without this step they are stripped as
 * punctuation: `großhändler` becomes `gro handler`. A word split into fragments
 * matches no rule and is then dropped, which is how an accented query
 * account ends up looking as though it has no commercial intent at all.
 */
const IRREDUCIBLE_LETTERS: readonly (readonly [RegExp, string])[] = [
  [/ß/g, "ss"],
  [/đ/g, "d"],
  [/ø/g, "o"],
  [/æ/g, "ae"],
  [/œ/g, "oe"],
  [/ð/g, "d"],
  [/þ/g, "th"],
  [/ł/g, "l"],
];

export function normalizeSearchQuery(query: string): string {
  let prepared = query.toLowerCase();
  for (const [pattern, replacement] of IRREDUCIBLE_LETTERS) {
    prepared = prepared.replace(pattern, replacement);
  }

  return prepared
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Returns every unigram and adjacent bigram, including its source position. */
export function tokenizeNgrams(query: string): QueryNgram[] {
  const tokens = normalizeSearchQuery(query).split(" ").filter(Boolean);
  const ngrams: QueryNgram[] = tokens.map((value, start) => ({
    value,
    size: 1,
    start,
  }));

  for (let start = 0; start < tokens.length - 1; start += 1) {
    ngrams.push({
      value: `${tokens[start]} ${tokens[start + 1]}`,
      size: 2,
      start,
    });
  }

  return ngrams;
}

function emptyScores(): Record<IntentTier, number> {
  return {
    brand_intent: 0,
    high_commercial: 0,
    informational_consideration: 0,
    low_intent_irrelevant: 0,
  };
}

function round(value: number, decimals = 4): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function classifySearchIntent(
  query: string,
  profile: IntentProfile = DEFAULT_INTENT_PROFILE,
): IntentClassification {
  const normalizedQuery = normalizeSearchQuery(query);
  const tokens = normalizedQuery.split(" ").filter(Boolean);
  const ngrams = tokenizeNgrams(query);
  const values = new Set(ngrams.map((ngram) => ngram.value));
  const scores = emptyScores();
  const signals: IntentSignal[] = [];

  for (const rule of [...LEXICON, ...MARKET_LEXICONS[profile.market]]) {
    if (!values.has(rule.pattern)) continue;
    scores[rule.tier] += rule.weight;
    signals.push({ ...rule });
  }

  for (const { alias, weight } of profile.brandTerms) {
    // A multi-word alias whose words are separated in the query — "kopi di
    // senja" for "kopi senja" — is matched on its words instead, because the
    // feature contract deliberately stops at bigrams.
    const parts = alias.split(" ").filter(Boolean);
    const matched = values.has(alias)
      || (parts.length > 1 && parts.every((part) => tokens.includes(part)));
    if (!matched) continue;

    const signal: IntentSignal = {
      tier: "brand_intent",
      pattern: alias,
      weight,
      reason: "matches a brand alias registered for this account",
    };
    scores.brand_intent += weight;
    signals.push(signal);
  }

  const ranked = TIER_ORDER.map((tier) => ({ tier, score: scores[tier] })).toSorted(
    (left, right) => right.score - left.score || TIER_ORDER.indexOf(left.tier) - TIER_ORDER.indexOf(right.tier),
  );
  const winner = ranked[0];
  const runnerUp = ranked[1];
  const tier = winner.score === 0 ? "informational_consideration" : winner.tier;
  const winningScore = winner.score === 0 ? 0.5 : winner.score;
  const runnerUpScore = winner.score === 0 ? 0 : runnerUp.score;
  const confidence = Math.min(
    0.99,
    Math.max(0.5, 0.5 + 0.5 * ((winningScore - runnerUpScore) / (winningScore + 1))),
  );

  return {
    query,
    normalizedQuery,
    tier,
    classified: winner.score > 0,
    label: INTENT_TIER_LABELS[tier],
    confidence: round(confidence),
    scores,
    tokens,
    ngrams,
    signals,
  };
}

/**
 * Accuracy under one account's profile. A corpus containing brand queries has
 * to be evaluated with that account's brand aliases, because brand detection
 * is per account and not part of the shared lexicon.
 */
export function evaluateIntentClassifier(
  corpus: readonly LabelledIntentQuery[],
  profile: IntentProfile = DEFAULT_INTENT_PROFILE,
): IntentClassifierEvaluation {
  const confusionMatrix = Object.fromEntries(
    TIER_ORDER.map((expected) => [
      expected,
      Object.fromEntries(TIER_ORDER.map((actual) => [actual, 0])) as Record<IntentTier, number>,
    ]),
  ) as Record<IntentTier, Record<IntentTier, number>>;
  let correct = 0;

  for (const item of corpus) {
    const actual = classifySearchIntent(item.query, profile).tier;
    confusionMatrix[item.expectedTier][actual] += 1;
    if (actual === item.expectedTier) correct += 1;
  }

  return {
    total: corpus.length,
    correct,
    accuracy: corpus.length === 0 ? null : correct / corpus.length,
    confusionMatrix,
  };
}
