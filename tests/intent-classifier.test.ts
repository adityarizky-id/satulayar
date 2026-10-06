import assert from "node:assert/strict";
import test from "node:test";

import {
  classifySearchIntent,
  evaluateIntentClassifier,
  normalizeSearchQuery,
  resolveIntentProfile,
  tokenizeNgrams,
  type LabelledIntentQuery,
} from "@/lib/analytics/intent-classifier";

// Brand aliases belong to an account, not to the shared lexicon, so a brand
// corpus is evaluated under that account's profile.
const KOPI_SENJA = resolveIntentProfile("kopi-senja");

test("tokenizer emits deterministic unigrams and adjacent bigrams", () => {
  const ngrams = tokenizeNgrams("Wholesale coffee beans, ID!");

  assert.deepEqual(
    ngrams.map(({ value, size, start }) => ({ value, size, start })),
    [
      { value: "wholesale", size: 1, start: 0 },
      { value: "coffee", size: 1, start: 1 },
      { value: "beans", size: 1, start: 2 },
      { value: "id", size: 1, start: 3 },
      { value: "wholesale coffee", size: 2, start: 0 },
      { value: "coffee beans", size: 2, start: 1 },
      { value: "beans id", size: 2, start: 2 },
    ],
  );
});

test("weighted signals separate commercial, research, and irrelevant intent", () => {
  const commercial = classifySearchIntent("buy wholesale arabica beans in bulk");
  const research = classifySearchIntent("how to brew arabica beans");
  const irrelevant = classifySearchIntent("free cold brew recipe pdf");

  assert.equal(commercial.tier, "high_commercial");
  assert.ok(commercial.scores.high_commercial > commercial.scores.informational_consideration);
  assert.equal(research.tier, "informational_consideration");
  assert.equal(irrelevant.tier, "low_intent_irrelevant");
  assert.ok(irrelevant.confidence >= 0.5 && irrelevant.confidence <= 1);
});

test("Kopi Senja Nusantara aliases remain brand intent even with wholesale modifiers", () => {
  assert.equal(classifySearchIntent("Kopi Senja Nusantara wholesale login", KOPI_SENJA).tier, "brand_intent");
  assert.equal(classifySearchIntent("kopisenja trade account", KOPI_SENJA).tier, "brand_intent");
});

test("labelled corpus meets the mathematical accuracy gate", () => {
  const corpus: LabelledIntentQuery[] = [
    { query: "Kopi Senja Nusantara wholesale", expectedTier: "brand_intent" },
    { query: "kopi senja trade account", expectedTier: "brand_intent" },
    { query: "kopi senja drip bag", expectedTier: "brand_intent" },
    { query: "kopisenja login", expectedTier: "brand_intent" },
    { query: "harga grosir kopi arabika", expectedTier: "high_commercial" },
    { query: "bulk green coffee beans supplier", expectedTier: "high_commercial" },
    { query: "trade coffee supplies", expectedTier: "high_commercial" },
    { query: "buy wholesale robusta", expectedTier: "high_commercial" },
    { query: "b2b coffee distributor", expectedTier: "high_commercial" },
    { query: "cara membuat cold brew", expectedTier: "informational_consideration" },
    { query: "apa itu kopi single origin", expectedTier: "informational_consideration" },
    { query: "best coffee for espresso", expectedTier: "informational_consideration" },
    { query: "panduan seduh v60", expectedTier: "informational_consideration" },
    { query: "perbedaan arabika dan robusta", expectedTier: "informational_consideration" },
    { query: "lowongan barista kopi", expectedTier: "low_intent_irrelevant" },
    { query: "resep kopi gratis pdf", expectedTier: "low_intent_irrelevant" },
    { query: "kopi arabika shopee", expectedTier: "low_intent_irrelevant" },
    { query: "school project coffee tutorial", expectedTier: "low_intent_irrelevant" },
    { query: "mesin kopi bekas olx", expectedTier: "low_intent_irrelevant" },
  ];
  const evaluation = evaluateIntentClassifier(corpus, KOPI_SENJA);

  assert.equal(evaluation.total, 19);
  assert.ok((evaluation.accuracy ?? 0) >= 0.9, `accuracy=${evaluation.accuracy}`);
  assert.equal(
    Object.values(evaluation.confusionMatrix).reduce(
      (total, row) => total + Object.values(row).reduce((sum, count) => sum + count, 0),
      0,
    ),
    evaluation.total,
  );
});

test("empty evaluation returns no fabricated accuracy", () => {
  assert.equal(evaluateIntentClassifier([]).accuracy, null);
});

test("letters NFKD cannot decompose survive normalisation", () => {
  // Stripped as punctuation before, which split the word into fragments the
  // length filter then dropped: an accented query matched nothing.
  assert.equal(normalizeSearchQuery("Großhändler"), "grosshandler");
  assert.equal(normalizeSearchQuery("Njuškalo"), "njuskalo");
  assert.equal(normalizeSearchQuery("Đakovo"), "dakovo");
  assert.equal(normalizeSearchQuery("återförsäljare"), "aterforsaljare");
  assert.equal(normalizeSearchQuery("niño"), "nino");
});

test("an Indonesian second-hand query is low intent, not unmatched", () => {
  const indonesian = resolveIntentProfile("batik-lestari");
  const classification = classifySearchIntent("kain batik bekas olx", indonesian);

  assert.equal(classification.tier, "low_intent_irrelevant");
  assert.equal(classification.classified, true);
});

test("an unmatched query says so rather than claiming a tier", () => {
  const classification = classifySearchIntent("zzz qqq");

  assert.equal(classification.classified, false);
  assert.equal(classification.tier, "informational_consideration");
});
