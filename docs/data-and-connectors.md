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

## Setup and recovery interaction contract

Every active connector must provide a server-derived setup description on Data
sources. This applies to future connectors before they leave the Planned group:

- Expose required setting **names and presence booleans only**, provider/account
  prerequisites, the exact callback built from the configured site origin, and
  the provider documentation link. Never serialize credential values.
- Missing deployment configuration shows `Config required` and opens **View setup
  requirements** in the shared modal. Viewers may read the checklist; mutation
  permissions stay enforced separately. Do not offer re-authorization or a
  success confirmation while deployment prerequisites are missing.
- Separate authorization readiness from reporting readiness: account mapping,
  currency/timezone, event mapping, token lifecycle and the runtime live-sync
  gate still need verification. A present setting is labelled unvalidated.
- Credential-form connectors need server storage, but do not require deployment
  OAuth credentials or a callback. OAuth connectors use the same origin resolution
  as authentication, including its supported Vercel fallback.
- A `connected=...&status=success` return URL is not connection evidence. The row
  must also have a server-confirmed active credential and no configuration block.
  An OAuth error takes precedence over a simultaneous success parameter.
- Pass the selected brand explicitly into authorization, testing and disconnect
  requests. Planned connectors expose no authorization or credential mutation.

The shared checklist currently covers Google Ads, Meta Ads and GA4. Adding a
connector requires its own setting names, permissions, account mapping, recovery
steps and regression coverage; do not reuse another provider's checklist.

### Self-service credential forms

Editors and administrators use **Configure connection** on Data sources. Each
active platform has its own fields and provider instructions:

| Platform | Form input | Verified and persisted |
|---|---|---|
| Google Ads | Customer ID, developer token, optional manager ID; Google consent receives the refresh token automatically. Reuse the workspace OAuth app or enter a client pair under OAuth app settings. Manual API grants remain available. | Existing direct API verification and per-brand credential storage |
| Meta Ads | Ad account ID, access token, app-supported Graph API version, expiry date from a native calendar, optional campaign-name filter | Exact account and native currency, reporting permission, then token and brand-specific campaign scope/API version |
| GA4 | Numeric property ID and Google consent; workspace OAuth app or a matching client pair. Manual refresh-token entry remains available. | Read-only report probe, then property and OAuth pair used together by sync |

Platform details are stored server-side in the existing service-role-only
`connector_tokens` table. No deployment environment edit or redeploy is required
to enter or replace them. Secrets are never returned to the form, response, or
audit log; closing a form clears its input. Login autofill is discouraged using
new-password semantics on secret fields and password-manager exclusion hints.

The database URL/worker secret and authenticated deployment are installation
prerequisites, not per-platform form inputs. A missing installation prerequisite
is shown explicitly; a deployed preview identity cannot save credentials. Mock
mode and live-sync policy remain separate from successful API authorization.
Saving credentials never silently enables live ingestion or changes campaigns.

Meta's date picker uses the device timezone and sends the start of the selected
day as an ISO timestamp. This conservative renewal cutoff does not extend a
token beyond its unknown expiry time within that day. Past dates and today
require renewal before connecting; users never need to type an ISO timestamp.

New platforms must register a form schema, server-side validation/probe,
brand-scoped storage and runtime reader before leaving Planned. The endpoint
rejects unsupported platforms and uses only fixed provider origins.

### Connection popup contract

Every active connector shares a platform-branded progress surface: authorize or
check credentials, verify reporting, then save. Success appears only after the
server confirms verification and storage; it auto-closes after 1.8 seconds.
Errors remain actionable. Escape or Stop waiting closes the local surface;
neither action claims to revoke a grant or undo a request already accepted.
Future connectors must use the same status contract before leaving Planned.

Google Ads and GA4 open the official Google account/consent window from
**Continue with Google**. They request their own scopes, offline access and
account selection. Google Ads has Google's standard `adwords` scope; the
application still only performs reporting reads. GA4 requests `analytics.readonly`.
The operator must register the displayed exact callback in the selected Google
Cloud OAuth web client. Provider app setup/review remains a prerequisite.
See [Google's web-server OAuth flow](https://developers.google.com/identity/protocols/oauth2/web-server).

The POST authorize bootstrap validates role, brand, origin and storage before
opening consent. Draft application settings are encrypted/authenticated in a
15-minute httpOnly, SameSite cookie, bound to the initiating user, brand and
random CSRF state. No draft credential replaces an active row. The callback
checks the same binding, requires an ongoing grant and checks reported scopes,
then reuses the credential endpoint's provider probe and persistence checks.
Only a safe summary enters the encrypted result cookie. Parent polling checks
the attempt and user/brand binding, so Google COOP restrictions on the opener
do not turn a closed window or a client message into connection evidence.
The Google return window also auto-closes after confirmed success; failures
provide a manual Close action. Blocked popups and unconfirmed results give
explicit recovery instructions. No Composio dependency or external auth broker
is introduced.

## Known limits

- Demo brands report in **USD**. The `Currency` type already accepts `IDR`, `SGD`, and `MYR`, but fixture values are scaled for USD; IDR demo data needs a currency-aware fixture scale.
- Budget pacing uses repeating **30-day reporting cycles** with a fixed anchor. Making the anchor configurable per workspace is an open backlog item.
