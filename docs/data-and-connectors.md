# Satulayar — Data and Connectors

How data enters Satulayar, what each connector may do, and the rules that keep demo data from being mistaken for real data. Read this before changing ingestion, KPIs, fixtures, or anything under `src/lib/connectors/`.

## Source hierarchy

1. Platform APIs (Google Ads, Meta Marketing API, GA4), on the account and reporting settings agreed per brand.
2. The store's own order records, which are the realised outcome and the check on platform claims.
3. Reviewed worklog entries.
4. Generated summaries, which are interpretation and never a source of fact.

## Data flow

```
Platform API ──(read-only connector)──> sync job ──> Supabase tables ──> dashboard
                                           │
                                  data-quality gate
```

- The browser never calls an ad platform. The refresh button creates a **sync job**; the dashboard reads the database.
- A daily cron (`/api/cron/daily-sync`, see `vercel.json`) pulls the previous day for every connected brand.
- `scripts/ingestion/backfill-live-window.ts` loads history from a terminal. Every table upserts on a stable grain key, so running it twice corrects rather than duplicates.

## Modes

| Setting | Values | Rule |
|---|---|---|
| `DASHBOARD_DATA_MODE` | `mock`, `live` | `live` fails closed until credentials, event mapping, and parity are approved |
| `DASHBOARD_DATA_STORE` | `fixture`, `supabase` | Fixtures run in memory; Supabase persists snapshots |
| `DASHBOARD_AUTH_MODE` | `preview`, `supabase` | Preview is local-only; production refuses to start without Supabase |

## Connector boundaries

- **Read-only, always.** No connector mutates a campaign, budget, audience, or conversion setting.
- **One brand, one account.** A brand resolves its own customer or ad-account id; nothing falls back to the pilot brand's account, and two brands mapped to one account both refuse to sync.
- **Currency is a guard, not a conversion.** Rows are stored in the account's native currency. Mixed currencies are never summed; the affected card shows "Mixed".
- **Timezone is per account.** The data-quality gate compares platform timezones and flags day-boundary shifts instead of hiding them.
- **Shared ad accounts are filtered.** When several brands share one Meta ad account, a campaign-name filter or prefix (`CANONICAL_META_BRAND_MAP`) keeps each brand's spend separate.

| Connector | State |
|---|---|
| Google Ads | Implemented, fail-closed in demo |
| Meta Ads | Implemented, fail-closed in demo |
| GA4 | Implemented, fail-closed in demo |
| Store (Shopify, WooCommerce) | Planned; store analytics runs on synthetic, store-shaped fixtures |
| TikTok Ads, Microsoft Ads, Search Console | Planned |

## Demo data rules

- Every brand, product, customer, and account id in fixtures is **fictional**. Account ids are obviously synthetic (`100000000000001`, `1234500001`).
- Fixtures are deterministic, so the server, the browser, and tests render the same numbers.
- Demo data is always labelled as preview data. It is never presented as real performance.
- Never paste real client data, customer records, or account ids into fixtures or tests.

## Known limits

- Demo brands report in **USD**. The `Currency` type already accepts `IDR`, `SGD`, and `MYR`, but fixture values are scaled for USD; IDR demo data needs a currency-aware fixture scale.
- Budget pacing uses repeating **30-day reporting cycles** with a fixed anchor. Making the anchor configurable per workspace is an open backlog item.
