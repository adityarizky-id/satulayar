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

## Theme behavior

- `light` and `dark` are the only user-facing modes.
- On a first visit, use the operating-system preference.
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

Cards use 14px radii by default. Controls use 9–10px. Pills are reserved for compact status, filters, and toggles. Light cards may use the shared shallow shadow. Dark cards normally use a boundary, not a halo.

## Typography

- Mode is **Operate**: readability and scanning outrank editorial spectacle.
- Use the existing workhorse sans stack with `Segoe UI Variable` preferred where available.
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
- Wide tables may scroll only inside a bounded scroller.
- Primary touch targets are at least 44px.
- Reflow before shrinking essential type.
- Sticky chrome, popovers, tooltips, and badges remain within the viewport.

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
