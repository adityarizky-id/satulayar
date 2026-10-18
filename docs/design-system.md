# Satulayar — Visual Design System

This is the canonical visual contract for Satulayar. Every AI runtime and developer must read it before changing layout, color, charts, cards, elevation, typography, motion, or responsive behavior.

Related: `README.md` · `AGENTS.md` (UI/UX and AI development convention)

## Direction — Signal Workspace

Signal Workspace is a dual-theme operational environment. The light theme is a bright data workspace with a near-black green sidebar and crisp white working surfaces. The dark theme is neutral ink and graphite with green reserved for action, selected state, primary data, and bounded illumination. Neither theme floods the entire canvas with saturated green.

The references establish the following visual character:

- dense but highly legible dashboard composition;
- near-black navigation shell shared by both themes;
- clean white/light-gray surfaces in light mode;
- layered black/graphite surfaces in dark mode;
- vivid green as a signal, not a background default;
- controlled glow only where it helps a dark chart reveal an active mark;
- low-intensity frost only on sticky utility and reporting-period chrome.

The old 65/25/10 composition is retired. Color follows hierarchy, meaning, and ambient-light use rather than a fixed screen percentage.

### Google Stitch implementation reference — 17 October 2026

The private **SatuLayar — Faithful UI Replica** suite supplies six desktop page
pairs in Light and Dark: Paid ads, Store analytics, Worklog, Data sources,
Account & access, and Sign-in. Use the named primary screens, not earlier drafts.
Signal Workspace remains the semantic and accessibility contract when generated
markup introduces unsupported actions, live claims, or different metric meanings.

- A 194px expanded navigation shell stays dark in both themes; the existing
  collapse preference and mobile drawer remain functional.
- Use the full available workspace with 24px desktop gutters and 20px section
  spacing. Operational headings are 24px; page headers stay unframed. Sticky
  utility and reporting chrome retain the existing restrained frost.
- The diagnostic snapshot uses a one-third verdict and two-thirds 4×2 metric
  grid at wide widths. Budget pacing and platform performance each share one
  bounded section surface. Preserve all existing calculations and controls.
- Account identity and permissions sit side by side at wide widths. Brand
  workspaces become a five-card row, then reflow through three, two, and one
  column. Restricted permissions are explicitly labelled without offering an
  elevation action or changing authorization.
- Sign-in uses a 60:40 desktop split, a static two-line headline, a restrained
  network illustration, and a 420px form card. The left stage stays dark in both
  themes; the form follows semantic theme surfaces. The preview context is
  labelled, without invented live metrics, security guarantees, or legal terms.
- Keep native forms, source status, demo markers, working navigation, keyboard
  focus, responsive tables, and reduced-motion behavior. Do not replace the
  application with the generated static HTML or import its placeholder links.

## Theme behavior

- `light` and `dark` are the only user-facing modes.
- On a first visit, use Dark. An explicit saved Light or Dark choice takes precedence.
- Persist an explicit choice in `localStorage` under `satulayar-theme`.
- Apply the selected mode to `html[data-theme]` before first paint to avoid theme flash.
- The toggle must appear in the utility bar on every protected application route.
- Theme changes remap semantic tokens; components must not maintain separate hardcoded palettes.
- Both modes preserve product behavior, information density, content, metric meaning, and responsive structure.

### Palette anchors

| Role | Light | Dark |
|---|---:|---:|
| Canvas | `#F2F5F2` | `#080A09` |
| Primary card | `#FFFFFF` | `#0E110F` |
| Alternate card | `#F7F9F7` | `#121613` |
| Control | `#F7F9F7` | `#171C18` |
| Primary text | `#111713` | `#F1F6F2` |
| Secondary text | `#4F5F55` | `#A7B2AA` |
| Signal green | `#22C55E` | `#35E27D` |
| Sidebar base | `#07100B` | `#080B09` |

Raw color values belong only in the primitive/theme token sections of `src/app/globals.css`. Components consume semantic or component tokens.

## Semantic surfaces

| Role | Light | Dark |
|---|---|---|
| Application canvas | Cool off-white with a very faint mint field | Neutral black with at most one low-opacity green light source |
| Sidebar | Green-black navigation shell | Neutral black navigation shell |
| Standard panel | White with quiet border and shallow shadow | Graphite-black with quiet border and no resting shadow |
| Elevated panel | White with soft downward shadow | Slightly raised graphite with soft downward shadow |
| Control | Light-gray field | Raised neutral graphite field |
| Table header | Pale gray-green band | Dark graphite band |
| Sticky table column | Must match its row/header surface | Must match its row/header surface; never white |
| Utility and filter chrome | Translucent white frost | Translucent ink frost |
| Tooltip/popover | White elevated surface with dark text | Highest graphite surface with light text |

Light cards use 14px radii and controls use 9–10px. The revised Dark workspace uses 6–8px panel corners and 4–5px controls, with 10px workspace cards. Pills are reserved for compact status, filters, and toggles. Light cards may use the shared shallow shadow. Dark cards use a boundary, not a halo.

### Dark reconstruction — 17 October 2026

The approved sequence is Dark dashboard first, then Light, then Sign-in.
Dark supersedes the previous gradient material and rounded control treatment:

- Flat ink canvas `#080A09`, cards `#0E110F`, secondary surfaces `#121613`,
  controls `#171C18`, and visible mineral borders `#253028`. Values remain
  defined in theme tokens; selectors consume semantic roles.
- Inter and JetBrains Mono for the Store, Worklog, Account and Sources screens;
  Segoe UI and Consolas for the reference-matched Paid screen. Fonts retain
  system fallbacks. Restrained heading weight, mono metadata,
  square status labels, compact sidebar and controls, and distinct table bands.
- Paid ads follows the Reference matched screen
  `c42cf7908bef47bb9e1f91852431de75`. Its snapshot and target disclosure share
  one surface. Aditya subsequently selected the initial Paid draft's circular
  budget design: a compact ring with rounded ends and a centre percentage,
  alongside the cycle facts. Amber means ahead of pace, blue behind pace, green
  on track and red an actual budget breach. The normal lap stops at 100%; the
  overflow lap and explicit overspend preserve amounts above budget. No budget
  is N/A, never an invented zero-percent observation. Cycle explanations expand.
- The user-supplied ZIP supersedes the earlier malformed hosted Store render.
  Its styled extended `bb1b38d145fd49b5b9bfa441537e4142` screen is now the
  primary Store reference: graphite cards, compact heading and four KPIs,
  year legend beside the chart heading, with monthly data inside that card.
  Existing yearly, RFM, cohort, sales, traffic,
  catalogue, audience and referrer data remain available.
- Data sources spans active connectors across the workspace, with Planned
  and Runtime readiness beside one another when space allows. Missing setup
  is amber; rejected authorization remains red. No generated provider, timing,
  isolation or security claims are imported.
- Worklog retains review-before-publication, accessible forms and real sample
  labels. Account retains actual roles, permissions, workspace switching and
  audit state; no fictional session expiry or elevation action is introduced.
- Light reconstruction (18 October 2026): Light now shares the reconstructed
  geometry, density and typography. Rules that name a Dark-only palette token
  stay Dark-scoped. The Light material layer keeps the Light ZIP's 14px cards,
  9–10px controls, 4px chips, shallow card shadow, flat `#F2F5F2` canvas and
  `#E1E6E1`/`#D9E0D9` borders; the sidebar subtree remaps its own ink roles.
  Muted text keeps the AA-compliant value and primary buttons keep dark text
  on green rather than the reference's low-contrast white. Saved theme
  choices are preserved.
- Text overflow contract: bar-list labels, order-rail captions and the insight
  lead reflow instead of truncating without a title. Below 680px the RFM grid
  scrolls inside its figure, with rows tall enough for two-line segment names.

The ZIP correction also moves Paid utility chrome above both sidebar and main
content. Other routes keep the utility bar beside the sidebar. Desktop Worklog
shows four changes initially, with all samples and entity/author details still
expandable; its five-field row and paired textareas reflow on smaller screens.
The design export's generic `DESIGN.md` is reference material, not authority for
new product behavior. Screenshots are compared at a common 1280px width because
the PNG exports use different scale factors. Passing functional checks alone
does not establish visual fidelity or pixel equality.

RFM uses the reference's compact summary strip and neutral/green/amber surfaces.
Summary totals follow the selected real segments; AOV is total value divided by
orders. The existing scored segment areas remain intact rather than inventing
25 independent customer cells from a generative screenshot. Segment selection,
metric controls, customer deep dive and export behavior remain available.

## Typography

- Mode is **Operate**: readability and scanning outrank editorial spectacle.
- Use the page-specific workhorse stacks defined above, with system fallbacks.
- Headings use weight and scale, never gradient text.
- Data uses the mono stack with tabular numerals.
- Body text is at least 12px; chart axes and short badges may use 9–10px.
- Use sentence case. Uppercase is limited to short metadata and status labels.
- Display headings may reach 56px in hero surfaces; operational page headings stay compact.

## Growth and status color contract

Growth tone is calculated from the metric's `favorableDirection`, never from the sign alone.

| Semantic result | Color family | Required companion |
|---|---|---|
| Favorable | Emerald/mint | Arrow or explicit `up/down`, value, and comparison label |
| Unfavorable | Coral/red | Arrow or explicit `up/down`, value, and comparison label |
| Watch / near threshold | Amber | Status word or threshold explanation |
| Informational / selected | Cobalt blue | Selected state, label, or icon |
| Neutral / unchanged / unavailable | Mineral gray | `No change`, `N/A`, or equivalent text |

For lower-is-better metrics such as CPC, CPA, and CPO, a decrease is favorable and uses favorable styling. For higher-is-better metrics such as revenue, purchases, registrations, and ROAS, an increase is favorable. Red is reserved for a real breach, error, destructive action, or genuinely unfavorable movement.

## Chart color contract

### Stitch chart geometry and composition

The user's chart fidelity request supersedes the earlier horizontal budget
meter. Budget circles follow the chosen initial Paid draft, without a decorative
black endpoint cap or hover scaling. Actual percentages and budget provenance
remain visible. Shared ring geometry still handles an overflow lap.

Yearly grouped bars use a maximum 10-unit width, 4-unit inter-series gaps,
small corners and a neutral unfilled plot. The initial view matches the bar-only
reference; the labelled Orders trend toggle restores the order lines, and exact
orders remain in the monthly table and tooltip. Partial bars remain faded.

Composition uses green, pale blue, amber and pale violet in that order. Catalogue
bars, stacked segments and their legends share the same category mapping.
Horizontal composition bars scale to the share of the whole, rather than making
the largest category look like 100%. Ranking bars keep their maximum scale.
Zero values have zero-width/height geometry. Stacked columns use seamless square
segment joins and 10-unit stems; their plot is 256 units high. Composition donuts
use the same palette and thinner dark strokes, with readable values and shares.

Chart identity stays stable across pages and themes. Theme variants may change luminance for contrast but never change the series' semantic identity.

| Series role | Light | Dark | Typical usage |
|---|---:|---:|---|
| Series 0 · cobalt | `#2F6EC9` | `#66A3FF` | Spend, current comparison year, Google |
| Series 1 · signal green | `#16A85A` | `#35E27D` | Purchase value, Store, primary business result |
| Series 2 · amber | `#B7791F` | `#F4C35A` | ROAS, threshold, secondary comparison |
| Series 3 · violet | `#7657C8` | `#B29AFD` | Registrations, Meta, third comparison |
| Series 4 · cyan | `#148F8B` | `#4FD1C5` | Orders and supporting operational series |

Rules:

- A categorical series never changes color because performance improved or declined.
- Status/growth appears in annotation, badge, or comparison text—not by recoloring the whole series.
- Lines need a distinct dash pattern when multiple series coexist.
- Bars start at zero; partial periods use opacity plus a visible explanation.
- Gridlines and axes remain quieter than the data.
- Essential values remain available outside hover-only tooltips.
- Tooltip surfaces and text must resolve from the active theme together; a dark
  tooltip with light-theme text tokens, or the reverse, is a contrast failure.
- Chart plot areas may use a barely visible theme surface, never a nested decorative card.
- Period comparisons use the shared CSS context-depth tokens: the comparison area is slightly more transparent and renders behind the active period, while focus restores full emphasis.
- Glow is dark-only, bounded to an active/focused mark or one primary result line, and sourced from `--chart-glow-*` tokens.
- No permanent glow may reduce edge clarity, obscure a neighboring series, or replace hover/focus state.

## Cards, tables, and density

- One card answers one primary question.
- Light panels use the shared shallow shadow; dark panels normally use a quiet border with no resting shadow.
- Floating elements—tooltips, open pickers, sticky chrome—use the elevated shadow token.
- Use a 4px spacing base with common steps of 8, 12, 16, 20, 24, 32, and 40px.
- KPI grids use shared boundaries rather than many disconnected floating tiles.
- Tables use contained horizontal scrolling on small screens. Sticky columns must match the row or header surface.
- Hover may brighten a row or border but must not move dense data cards.
- Resting data cards keep their ordinary boundary and shadow on pointer hover;
  do not apply a halo to every card as the user scans. Keep canvas and operational
  page headers neutral. Reserve stronger emphasis for selected controls and data.
- Performance-target editing is a labelled disclosure below the snapshot. The
  active thresholds remain visible with their metrics; opening the editor is
  optional during routine reading.
- A chart and its detailed table may share one section and one filter state. If
  the table is collapsible, use an explicit action label, supporting summary,
  `aria-expanded`, and a directional icon; year toggles must filter both views.

## Source-separated revenue and ROAS

Paid-media value and store revenue are different evidence sources and must not
be merged into one unnamed metric:

- **Platform value** is the platform-reported conversion value.
- **Platform ROAS** is platform value divided by spend.
- **Store revenue** is store order revenue attributed to the platform.
- **Store ROAS** is store revenue divided by spend and belongs visually with
  Store revenue, not as a substitute for Platform ROAS.

Whenever both sources appear, label them explicitly and preserve the same
comparison basis. Do not present either ROAS as the universally “actual” ROAS.

## Frost and atmospheric effects

The utility bar and reporting-period filter retain their current low-intensity frost. Do not increase the blur, opacity contrast, or glass border until the chrome becomes conspicuous.

Non-blocking data-boundary disclaimers use an in-flow informational callout with
the shared info foreground, background, and border tokens, restrained frost,
and a visible plain-language explanation. They must not be reduced to a
hover-only tooltip or styled as a blocking amber/red incident.

Atmospheric effects are allowed only when they reinforce hierarchy:

- soft green radial light in sidebar, hero, sign-in, and selected high-level panels;
- chart glow only through documented dark-theme glow tokens and only on active/primary marks;
- slow ambient movement only on non-data backgrounds and disabled under `prefers-reduced-motion`;
- no texture over tables, chart marks, labels, or dense form controls.

## Motion

- Hover/focus: 120–180ms ease-out.
- Tooltip: 140–180ms entrance, faster exit.
- Filter/data update: 180–280ms continuity or crossfade.
- First meaningful surface entrance: at most 450ms and never replayed on every hover.
- Animate `transform`, `opacity`, shadow, clip, or blur intentionally; never `transition: all`.
- Data geometry never overshoots its truthful value.
- Reduced motion renders the correct final state immediately.

## Responsive contract

- Verify 1440px, 1024px, 760px, and 390px.
- No page-level horizontal scrolling.
- Table text wraps; do not force names, headings or recommendations onto one line.
- Shared table wrappers reflow into labelled metric rows when the workspace is
  too narrow (900px workspace width for more than seven columns; 680px for smaller tables).
  Preserve every metric, grouped-header label and native table role. Never hide
  columns or mask overflow to remove a scrollbar. Before client enhancement,
  the bounded native scroller remains an accessible fallback.
- Creative identity includes format and days active; recommendations wrap in
  the action cell. Small screens show the action across the full row.
- Insight lists use a fixed 72px badge column and a 12px gap. Headlines,
  explanation and evidence share one text edge regardless of badge length;
  the same component owns every insight and recommendation attachment.
- Remove redundant narrative below section cards. Keep material reporting
  limits, coverage and comparison notes in an accessible, collapsed disclosure
  inside a card. Data-origin and unavailable-data markers remain visible.
- Donut legends stack below the plot when a card cannot fit both comfortably;
  audit filters wrap and structured details wrap long values.
- Primary touch targets are at least 44px.
- Reflow before shrinking essential type.
- Sticky chrome, popovers, tooltips, and badges remain within the viewport.
- Utility controls reflow against the available workspace column, including the
  expanded sidebar, rather than relying only on viewport breakpoints. Scope,
  operations, and session controls keep separate layout zones. Secondary sync
  and timezone readouts may step out before essential controls are compressed.
- Measure utility-bar height with the shared observer and use that value for
  the sticky reporting picker. Mobile page titles and period details wrap fully.
- Utility and reporting controls use at least 12px text. Do not reduce the font
  size to force all utility controls into one row.
- Worklog uses a compact operational heading and secondary styling for repeated
  row actions. Account section shortcuts have explicit spacing and focus states.
- The sign-in headline stays static while a person reads or enters credentials.

## Runtime implementation contract

Every runtime must:

1. Read this file and `AGENTS.md` before UI work.
2. Reuse primitive → semantic → component tokens; do not place raw colors in component selectors.
3. Preserve both light and dark semantic mappings; never fix one theme by hardcoding over the other.
4. Use the growth and stable cross-theme chart contracts above.
5. Reuse existing components before creating stylistic duplicates.
6. Preserve the current frost strength for utility and filter chrome.
7. Verify affected pages at desktop and mobile widths.
8. Run the project UI detector, lint, typecheck, relevant tests, full tests for shared visual primitives, and production build.
9. Update this note when a durable visual decision changes. Do not create a competing design-system note.

## Reference interpretation guardrail

The supplied references set craft level, atmosphere, and visual confidence. They do not authorize copying website navigation, marketing claims, sculpture imagery, nail content, or decorative motion into the operational product. Product truth, accessibility, data honesty, and established dashboard behavior remain fixed.

## Definition of done

A UI change is complete only when it follows Signal Workspace at system level, works in both themes without first-paint flash, retains readable data semantics, covers interaction states, preserves accessibility, has no page-level overflow, and passes the required verification. A locally attractive component that introduces a private palette, radius, shadow, chart color, glow, or frost strength is a regression.
