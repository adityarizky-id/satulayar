# Satulayar — UI/UX and AI Development Convention

This file is the canonical instruction set for every AI runtime and developer working in this repository. Read it before changing UI, copy, charts, interactions, or styles. Runtime-specific files must point here instead of creating competing rules.

## Mandatory startup reading

Before substantial work, read `README.md` (product scope, data modes, and setup) and `docs/data-and-connectors.md` (data contract, connector boundaries, and the dummy-data rule).

Before any UI, chart, layout, styling, motion, or responsive work, also read `docs/design-system.md`. Its dual-theme **Signal Workspace** direction, semantic light/dark tokens, growth colors, stable chart identity, bounded glow, surface hierarchy, card/elevation rules, and restrained frost treatment are canonical. Do not create a competing visual rule set.

## Reporting cycles

Budget pacing and period comparison use repeating **30-day reporting cycles** (see `src/lib/dashboard/budget.ts` and `src/lib/dashboard/timeframes.ts`), not calendar months. Pacing, prorated targets, and like-for-like comparisons must apportion against the active cycle. Making the cycle anchor configurable per workspace is an open backlog item; do not hard-code a new anchor in feature code.

## Product character

This is a marketing-performance command center that must look modern, futuristic, and visually striking. Product direction: **visual quality is priority number one.** A view that is analytically correct but visually flat is not finished work.

Target character: dark-capable surfaces, deliberate depth, expressive gradients and lighting, generous type scale on hero numbers, and motion that makes the product feel alive. Information density is still expected — striking does not mean sparse — but "calm and operational" is no longer the ceiling. When a screen could be either restrained or impressive, build impressive.

The durable implementation of this character is **Signal Workspace**, defined in `docs/design-system.md`. Use that note instead of inventing a new palette or material language from this paragraph.

Data remains necessary, not optional. Where a real connector or metric is not ready, **build the full visual with clearly labelled dummy data** rather than shipping an empty or unstyled state. Dummy data unblocks visual work; it never gets presented as real.

## Priority order

When requirements conflict, use this order:

1. **Visual quality** — modern, futuristic, striking, coherent across the product.
2. Accessibility and complete interaction states.
3. Data accuracy and honest language, including honest labelling of placeholder data.
4. Clear hierarchy and fast scanning.
5. Consistency with existing patterns and tokens.

Two rules survive this reordering unchanged, because breaking them causes harm that no visual gain offsets:

- **Accessibility is not a style choice.** Contrast, visible focus, keyboard access, and `prefers-reduced-motion` still hold. A futuristic surface that fails contrast is a defect, not a look.
- **Never present placeholder numbers as real.** Dummy data must carry a visible marker in the UI — a badge, a watermark, a caption — so no client, manager, or screenshot can mistake it for live performance. Remove the marker only when the view is wired to a real source.

## Non-negotiable semantics

- Never use color alone to communicate meaning. Pair it with text, an icon, a pattern, or a numeric label.
- Green means favorable or healthy.
- Amber means watch, near threshold, or ahead of pacing while still within budget.
- Red means an actual breach, error, destructive action, or value beyond a hard limit. Do not use red for a budget that is still below 100%.
- Blue means informational or behind pacing; it is not an error color.
- Trend color must respect the metric's `favorableDirection`. A negative change can be favorable for cost metrics, and a positive change can be unfavorable.
- Use precise language: `ahead of pace`, `behind pace`, `on track`, `budget reached`, and `over budget`. Never label a value below 100% as `overspending` in the UI.

## Token architecture

Use three layers:

1. Primitive brand tokens such as `--sl-green`, `--sl-gray`, and `--sl-border` live in `:root`.
2. Semantic tokens such as `--status-positive-*`, `--status-warning-*`, and `--status-negative-*` express meaning.
3. Component aliases such as `--ring-overflow` express a component role and point to semantic tokens.

Rules:

- Do not add raw hex, rgb, or rgba values inside component selectors. Add or reuse a token in `:root`.
- Do not name a token after one page or data value.
- Reuse the spacing rhythm, radii, shadows, type families, and semantic colors already defined.
- A new state color requires foreground, background, and border tokens with readable contrast.

## Typography and density

- Use sentence case for headings, labels, buttons, and status copy.
- Body and explanatory text should be at least 12px. Metadata may be 10px; reserve 8.5-9px for short badges or chart axes only.
- Keep body line-height at 1.4 or greater. Numeric KPI values may be tighter.
- Use the mono font only for values, timestamps, IDs, and compact technical metadata.
- Never solve overflow by shrinking essential text. Reflow, truncate with an accessible title, or change layout.

## Layout and spacing

- Use a 4px spacing rhythm. Common gaps are 4, 8, 12, 16, 20, 24, and 32px.
- Align card titles, values, and actions to shared edges.
- Minimum interactive target is 40px on desktop and 44px on touch layouts. Compact 30-34px controls are allowed only for secondary desktop actions with sufficient spacing.
- Cards should answer one primary question. Split a card when two unrelated tasks compete for attention.
- Dense data is allowed; cramped controls and ambiguous grouping are not.

## Component state contract

Every interactive component must account for:

- default
- hover where a pointer exists
- keyboard focus using `:focus-visible`
- active/pressed when applicable
- disabled
- loading or submitting
- error
- empty/no-data

Do not hide a required state inside hover-only UI. Loading must not cause major layout shift. Error copy must say what failed and offer a safe recovery action when one exists.

## Chart convention

- A chart must have an accessible name and retain essential values outside hover-only tooltips.
- Tooltips use the shared `ChartTooltip` pattern. They must remain legible, avoid viewport clipping, and use semantic trend tones.
- Legends, series colors, and rendered marks must match exactly.
- Use a stable visual order across periods and platforms.
- Explain masked, partial, estimated, or unavailable data in visible copy.
- Animation is optional and must respect `prefers-reduced-motion`.

## Visualization selection SOP

This section is the project-level source of truth for every AI runtime that proposes, specifies, implements, or reviews a visualization in this dashboard. It turns the chart families in the product owner's reference image into an operational selection system. The reference inventory is: bar, line, pie or donut, scatter, heat map, bubble, word cloud, Sankey, ThemeRiver, radar, stacked bar, sunburst, funnel, treemap, candlestick, flow diagram, area, and Gantt. The inventory is a possibility space, not a requirement to use every type.

### Selection principle

Choose the simplest visual that answers the business question truthfully. The analytical relationship determines the chart; novelty does not. If a KPI card, ranked table, or short sentence communicates the answer more precisely, do not add a chart.

Before choosing a visual, establish:

1. The decision or question the reader must answer.
2. The metric definition, denominator, unit, and `favorableDirection`.
3. The grain: day, week, month, campaign, account, platform, device, geography, product, or cohort.
4. The comparison: previous equal-length period, prior year like-for-like, target, budget, benchmark, or none.
5. The account timezone, attribution basis, and native currency.
6. Whether data is complete, partial, provisional, estimated, stale, masked, suppressed, or unavailable.
7. Whether the compared values are genuinely comparable. Do not combine Google and Meta conversion counts as unique customers, mix currencies, or imply identical attribution definitions.

If any missing item would materially change the chart or its meaning, surface the gap before implementation. Otherwise proceed with a stated, reversible assumption.

### Decision matrix

| Analytical question | Preferred visual | Good dashboard use | Guardrail or fallback |
|---|---|---|---|
| What is the current value or verdict? | KPI card or status summary | Spend, ROAS, CPA, conversion rate, data freshness | Include unit, comparison, and status text; a chart is unnecessary for one number. |
| Which category is larger or ranks highest? | Horizontal bar or `BarList` | Campaign, product, referrer, country, or search-term ranking | Sort by value unless a stable business order matters. Use a table when exact lookup is primary. |
| How do a few categories compare across periods? | Grouped column | Monthly sales by year, platform totals by period | Start the quantitative axis at zero. Avoid more than about five series. |
| How does a metric change over time? | Line | Daily spend, sessions, AOV, CPA, conversion rate | Use a continuous time axis and equal intervals. A line axis may be truncated only when the scale remains explicit and honest. |
| How does accumulated magnitude change over time? | Area | Total traffic or spend volume where magnitude is important | Prefer a line when the filled area adds no meaning. Never obscure smaller series with overlapping opaque fills. |
| How does composition change over time? | Stacked area or stacked column | Channel share by month, device mix by period | Use shares when the question is composition and absolute values when the question is volume. Prefer small multiples when layers are hard to compare. |
| What is the part-to-whole composition for one period? | 100% stacked bar | Impression share served versus lost, device share | Keep a consistent segment order and show numeric values. This is the default part-to-whole visual. |
| What is the part-to-whole composition with very few categories? | Donut, only by exception | Channel or device share with 2-5 slices | Keep a labelled list or exact values beside it. Use a bar for close values, more than five slices, or precise comparison. Never use a 3D pie. |
| Is there a relationship between two numeric metrics? | Scatter | Spend versus conversions, CPC versus conversion rate | State that correlation is not causation. Show units and enough observations; do not connect unrelated points. |
| Does a third quantitative variable materially change that relationship? | Bubble | Spend versus conversions with bubble size as revenue or volume | Use only when the size encoding is essential and labelled. Otherwise use scatter or small multiples. |
| Where are concentrations or repeated patterns? | Heat map | Day-by-hour activity, campaign-by-metric matrix, cohort retention | Provide a readable scale and values or an accessible table. Do not use status red/green as a magnitude palette. |
| How does a valid sequential population convert? | Funnel | Sessions to product views to checkout to purchase | Every step must use the same population and a monotonic sequence. Show counts and step rates. If stages come from incompatible sources, use journey cards instead. |
| How does volume move between sources and destinations? | Sankey | Channel to landing page to conversion path when path identity is reliable | Reserve for true flow data with conserved or explicitly reconciled volume. For a simple process, use a flow diagram. |
| How do hierarchical parts contribute to a whole? | Treemap | Product category to product contribution | Use when area is meaningful and labels remain readable. Use ranked bars when precise comparison matters. |
| How do multiple hierarchy levels branch? | Sunburst, rare | Channel to campaign to ad group exploration | Use only for hierarchy exploration, not primary reporting. Provide breadcrumb, labels, and a table fallback. Prefer treemap or drill-down bars on small screens. |
| Where is performance geographically concentrated? | Choropleth or symbol map plus ranked table | Country, region, county, municipality, city, or district | Normalize rates when population or traffic volume differs. Never rely on area or color alone; preserve the ranked table and masked-data explanation. |
| What is the distribution or spread? | Histogram, box plot, or dot plot | CPC distribution, order value spread, campaign CPA variability | Do not use category bars as a histogram. Expose sample size and outliers; use a table for tiny samples. |
| How did components produce a total change? | Waterfall | Spend variance, revenue bridge, period-over-period contribution | Label start, positive and negative contributions, and end. Do not substitute a stacked bar when the cumulative bridge is the question. |
| How does actual performance compare with a target? | Bullet chart, reference line, or status card | CPA versus target, ROAS versus target, pacing versus expected | Show the target explicitly. Use the dedicated progress ring only for budget consumption. |
| What happened around an intervention? | Annotated line or event timeline | Campaign launch, budget change, worklog action, tracking outage | An annotation may show timing, not claim causality. Link or cite the worklog evidence when available. |
| What is the sequence of a process or decision? | Flow diagram | Connector state, approval path, sync lifecycle | Use nodes and arrows for logic, not quantitative magnitude. Use Sankey only when link widths encode valid flow. |
| When will implementation work happen? | Gantt | Delivery plan, dependencies, rollout schedule | Keep project planning outside the performance view unless schedule context is explicitly requested. Do not imply precision beyond the underlying plan. |
| How does financial open-high-low-close data move? | Candlestick, normally out of scope | Only a future dataset with genuine OHLC-like values | Do not use for PPC variation, ranges, or confidence intervals. Use interval, box, or line charts instead. |
| Which terms occur most often? | Ranked bar; word cloud only as exploration | Search-query or feedback theme discovery | Word clouds do not support precise comparison and are never a primary performance visual. Pair any exploratory cloud with counts. |
| How do many categorical dimensions compare as a profile? | Small-multiple bars; radar only by exception | A normalized diagnostic profile across a few stable dimensions | Radar requires a shared scale, stable axis order, few dimensions, and no ranking claim. Prefer bars for decision-making. |
| How do many streams evolve around a baseline? | Small multiples or stacked area; ThemeRiver only by exception | Exploratory topic-volume streams over time | ThemeRiver is not a default dashboard chart because baselines and layer thickness are difficult to compare. |

### Project defaults

Use these mappings unless the data question requires something else:

- Account verdict: snapshot or KPI card with explicit pass, near, breach, or unavailable text.
- Spend and outcome trend: `LineChart`; keep differently defined metrics in separate panels or normalize them explicitly.
- Platform or year comparison: `ColumnChart` with common units and a zero baseline.
- Budget consumption: Aditya selected the initial Stitch Paid draft's compact circular design in the chart-fidelity follow-up. Use a rounded progress ring with centre percentage and adjacent cycle budget, spend, remaining amount and plan provenance. Keep the first lap at 100% and preserve overflow in a second lap plus explicit accessible/text amounts. An unset budget displays N/A. Do not use a pie, gauge, or speedometer.
- Impression share: `StackedShareBars`, with masked values visible in copy and the supporting table.
- Channel, device, product, referrer, and location share: ranked `BarList` by default; `DonutChart` only for a small, stable part-to-whole view with adjacent exact values.
- Customer journey: ordered journey metrics by default; use a funnel only when the population and step definitions are compatible and monotonic.
- Geography: map plus ranked table. The table remains the precision and accessibility fallback.
- Cohort retention: heat-map-style cohort grid plus a semantic table.
- Worklog impact: annotated time series that marks the action date and links the evidence; do not imply the action caused the movement without analysis.
- Data quality, connector health, account mapping, and audit evidence: status summary or table, not a decorative chart.

### Encoding and scale rules

- Bar, column, histogram, area magnitude, and bubble-size encodings require a meaningful zero baseline. Do not truncate bars.
- Line charts may use a non-zero baseline only when the range and reason are visible and the view does not exaggerate a trivial change.
- Use time left-to-right and categories in a stable business order or a clearly stated value rank.
- Do not use dual quantitative axes for unrelated units. Split the view, normalize to an explicit index, or use small multiples.
- Do not mix currencies in one quantitative scale. Do not silently convert native account currency.
- Rates need their denominator; counts need their population and coverage period.
- Stacked visuals must preserve segment order across rows and periods. Do not compare too many thin layers.
- Bubble area, not radius, represents magnitude. Constrain extreme sizes and provide exact values.
- Map color represents a declared measure, not vague performance. Show whether the measure is total, rate, share, or indexed value.
- A missing value is not zero. Render missing, masked, suppressed, provisional, and partial values as distinct states.
- When the current period is incomplete, visibly mark the partial interval and compare only like-for-like elapsed days.

### Color, labels, and narrative

- Apply the semantic color rules in this file after determining `favorableDirection`; do not inherit a generic red-negative or green-positive palette from a library.
- Use sequential color for magnitude, diverging color only around a meaningful midpoint, and categorical color for identity. Status colors remain reserved for status meaning.
- Keep category identity consistent across views. Platform colors, legend labels, series marks, tooltips, and tables must agree.
- Prefer one emphasized series and quiet context when the question has a clear focus.
- Titles state the takeaway when evidence supports one. Otherwise use a neutral question or scope title; never manufacture an insight.
- Direct-label important series or endpoints when space permits. Tooltips add detail but never carry the only copy of essential information.
- Add target/reference lines, event annotations, or shaded partial periods only when they answer the stated question.
- Use compact number formats for scanning and exact values in tooltips or tables. Always retain currency, percentage, count, rate, or duration units.

### Visual craft and product character

A technically correct plot is not automatically a finished dashboard visualization. Charts must feel like native product UI: polished, responsive, visually confident, and integrated with the surrounding information hierarchy. A raw research-style plot with default library colors, generic axes, a detached legend, and no interaction is a development artifact, not a shippable result.

- Start from the project's visual language: Satulayar tokens, consistent radii, deliberate spacing, and stable platform identity — then push the surface treatment further than a default admin template would.
- **Gradients, glass surfaces, glow, depth, and shader-driven backdrops are permitted and encouraged** as product surface treatment: panel and card backgrounds, hero and empty states, sign-in and shell chrome, KPI framing, accents behind a plot area.
- The one place they must not interfere is the **data encoding itself**: the mark that carries the value — bar length, line position, ring sweep, map shade, bubble area — stays readable and undistorted. Decorate around the value, never on top of the value.
- Give every chart a composed frame: insight-led or neutral title, short context, plot, essential value summary, and a useful footer or caveat when needed. Do not surround every plot with decorative chrome.
- Use depth only to express hierarchy. A tooltip or selected series may lift above the plot; background cards and gridlines stay quiet.
- Keep gridlines, axes, ticks, and tracks subordinate to the data. Remove visual noise without removing orientation.
- Give each chart family a memorable interaction — series focus, endpoint emphasis, an annotated worklog event. Layering two complementary effects is fine; stacking four unrelated ones on a single chart still reads as noise, not craft.
- Preserve generous plotting space. Labels must not collide, clip, rotate unnecessarily, or be solved by shrinking below the typography limits.
- Make the active datum feel tangible: brighten or thicken its mark, reveal a guide line, and let surrounding marks recede while remaining identifiable.
- Use tabular numerals for changing chart values and tooltip numbers so digits do not jump horizontally.
- Loading uses a skeleton that matches the final chart geometry and reserves its height. Empty, error, stale, partial, and unavailable states receive composed in-panel explanations rather than a blank plotting area.
- The visual signature should come from the data relationship *and* a deliberate surface treatment. Generic, unconsidered gradients and glow are still weak design — the objection is to laziness, not to the technique. Choose the effect on purpose, apply it consistently across the product, and keep it tied to the Satulayar token layer.

### Tooltip and direct-interaction contract

Tooltip behavior is expected on interactive charts when point-level or segment-level detail adds value. Hover alone is not sufficient.

- Reuse the shared `ChartTooltip` pattern and extend it centrally when a new capability is needed.
- Support pointer hover, keyboard focus, and a touch-safe tap or selection path. The same datum must expose the same content across input methods.
- A tooltip contains a clear context title, exact value with unit, series identity, and only the comparison, status, or caveat needed to interpret that datum.
- When useful, add previous-period value, absolute or percentage change, target variance, partial-period marker, or masked-data explanation. Do not turn the tooltip into a miniature report.
- Anchor the tooltip to the active datum, flip or clamp it inside the panel and viewport, and keep it clear of the pointer target. It must not flicker when the pointer crosses the tooltip boundary.
- Couple the tooltip with visible chart feedback: active marker, crosshair or guide line, focused bar or segment, and subdued context marks.
- Hover and focus must preserve the series' own color. Do not recolor every selected item to one accent and destroy categorical identity.
- A legend that controls series focus uses real buttons, visible `:focus-visible`, and matching hover and focus behavior.
- Tooltip content may be `aria-hidden` only when the same essential values and meaning are available in semantic text or a table outside it.
- On touch layouts, do not require precise hover. A tap may pin the tooltip until another datum is selected, the user taps outside, or presses Escape where a keyboard is present.
- Do not show tooltips for values that cannot be explained honestly. Masked, unavailable, and provisional values keep their explicit state.

### Motion behavior contract

Motion should make data easier to follow, make interaction feel responsive, preserve continuity when filters or values change, and make the product feel modern. Making the dashboard feel alive is a legitimate goal here, not a disqualifying one.

Use purposeful motion for four jobs:

1. **Orientation:** show where a tooltip, drill-down, expanded panel, or changed datum came from.
2. **Feedback:** acknowledge hover, focus, press, filter apply, refresh, or series selection immediately.
3. **Continuity:** help the reader track marks as data, sorting, timeframe, or layout changes.
4. **Hierarchy:** stage the primary insight before supporting context on first appearance.

Use this shared vocabulary when specifying behavior:

| Term | Project meaning |
|---|---|
| Hover effect | Visual change when the cursor moves over an element. |
| Continuity transition | A change that keeps the user oriented by visually connecting before and after. For example, making the same rectangle bigger and smaller. |
| Layout animation | When an element's size or position changes, it animates to the new spot instead of snapping. |
| Stagger | Animate several items one after another with a small delay between each, creating a cascade. |
| Ease-out | Starts fast, ends slow. The default for most UI and anything responding to the user. |
| Interruptible animation | An animation that can be smoothly redirected mid-flight instead of finishing first. |
| Purposeful animation | Motion should serve a function: orient, give feedback, show relationships, not just decorate. |
| Reduced motion | Respecting the user's `prefers-reduced-motion` setting by toning down or removing motion. |

Rules:

- Default motion intensity is expressive on entrances, chrome, and hero surfaces, and quick and quiet on high-frequency interactions. A rare, impressive entrance is welcome; a flourish that replays every time the pointer moves is not.
- Initial chart appearance may use a single opacity and transform reveal, a short clip reveal, or a restrained stagger when sequence carries meaning. It plays once per meaningful mount, not on every hover or incidental rerender.
- Hover and focus feedback should feel immediate. Selected marks may brighten, thicken, lift slightly, or reveal a guide; neighboring marks recede but never disappear.
- Tooltips use a subtle fade with a small origin-aware translate or scale. They appear from the active datum, not from an arbitrary corner of the chart.
- Filter and timeframe changes use a continuity transition or short crossfade. Preserve axes and panel geometry when possible so the reader can compare before and after without losing orientation.
- When ranked categories reorder, either animate positions with a clear layout transition or update instantly. Do not cross bars through one another ambiguously.
- Data geometry must end exactly at the true value. Avoid bounce, elastic overshoot, or spring configurations that temporarily depict a false bar height, ring progress, line value, or map magnitude.
- Number tickers are optional only for a rare summary update and must settle quickly with tabular digits. Do not roll every KPI on page load.
- Motion is interruptible. A new pointer, keyboard, filter, or navigation action takes control immediately instead of waiting for the previous animation to finish.
- Never delay access to data, input response, error feedback, or navigation for choreography.
- Animate explicit, inexpensive properties. Prefer `transform` and `opacity`; use SVG stroke or clip animation only when measured and necessary. Avoid layout-thrashing animation of `top`, `left`, `width`, or `height`, and avoid broad `transition: all`.
- Ambient looping motion — shader backdrops, drifting gradients, subtle parallax — is allowed on chrome and background surfaces: sign-in, shell backdrop, hero and empty states, card backgrounds. Keep it off the plot area itself: the marks that encode values do not loop, drift, or pulse once they have settled, because a moving mark reads as changing data. Scroll hijacking stays banned; it breaks navigation, not taste.
- Loading shimmer, when used, stops as soon as data resolves and becomes static under reduced motion. A spinner is reserved for compact actions that cannot use a structural skeleton.

### Motion timing baseline

Use existing project tokens or add semantic motion tokens in `:root`; do not scatter arbitrary durations and easing curves through components.

| Interaction | Baseline | Easing and behavior |
|---|---:|---|
| Hover or focus emphasis | 100-180ms | Ease-out; immediate response, subtle settle |
| Tooltip entrance | 120-180ms | Ease-out; fade plus 2-4px translate or restrained scale from the datum |
| Tooltip exit | 80-120ms | Faster than entrance; no lingering bubble |
| Press feedback | 80-140ms | Small scale or translate, then immediate release |
| Filtered data update | 180-320ms | Ease-in-out continuity or crossfade; stable panel height |
| First chart entrance | 240-450ms | Ease-out; at most 30-60ms stagger between meaningful series or groups |
| Panel expand or drill-down | 180-320ms | Origin-aware continuity transition; preserve spatial context |

The total entrance choreography for one chart should normally finish within 500ms. Linear easing is reserved for genuinely continuous progress or rotation, not UI entrances. Ease-in is not the default for user-triggered feedback because it feels delayed.

### Reduced motion and motion accessibility

- Honor `prefers-reduced-motion` for every chart and interaction. The reduced version renders the correct final state immediately while retaining tooltip, focus, selection, and drill-down functionality.
- Do not replace motion with disappearance. Preserve state changes using text, icon, stroke, pattern, or direct value updates.
- Avoid flashing, rapid repeated pulses, large zooms, and motion tied directly to pointer position.
- Auto-playing motion must not be required to understand a trend and must not continually attract attention away from active work.
- Keyboard navigation must never trigger long entrance choreography on every focus move.
- Verify reduced motion in the browser, not only by checking that a media query exists.

### Disallowed or exceptional patterns

- No 3D or perspective applied to a **data encoding** — no 3D bars, exploded pies, or tilted plot planes, because depth distorts the length, angle, and area a reader is asked to compare. 3D, perspective, and shader work in **chrome** (backdrops, hero panels, illustrations, empty states) is allowed and encouraged.
- No speedometer gauges for budget; use the approved horizontal cycle meter. The ring contract below applies only where a ring is retained.
- No chart selected only because it appears in the reference inventory or a component library.
- No more than one primary question per chart.
- No rainbow palette when order or magnitude can use one sequential scale.
- No pie or donut for time series, negative values, overlapping categories, precise ranking, or more than five slices.
- No funnel when stages use different populations, attribution systems, or non-sequential events.
- No Sankey without trustworthy source-to-destination path data.
- No radar, sunburst, word cloud, ThemeRiver, candlestick, or Gantt in the core performance dashboard without a written reason tied to the analytical question.
- No smoothed curve that suggests unobserved values. If smoothing is used for exploratory trend context, retain the observed points and disclose the method.
- No automatic causal wording from correlation, temporal coincidence, or an AI-generated summary.
- No static-only interaction design when hover, focus, or selection detail would materially improve interpretation.
- No animation that overshoots, reshapes, or temporarily falsifies the represented value.
- No hover-only tooltip without keyboard and touch consideration.

### Runtime response and implementation contract

When the product owner asks for a visualization, every AI runtime must:

1. Identify the business question and the decision the view should support.
2. Audit metric comparability, grain, unit, currency, timezone, attribution, and data-quality state.
3. Recommend one primary visual and briefly state why it fits; mention a fallback only when there is a material trade-off.
4. Reuse or extend `src/components/charts/` before creating a near-duplicate. A new chart component requires a real analytical need, not a stylistic variant.
5. Keep calculation and validation in `src/lib/`; keep rendering and interaction in components.
6. Provide the exact values or a semantic table outside hover-only UI, plus an accessible name and visible caveats.
7. Specify the chart's hover, focus, touch, tooltip, entrance, update, and reduced-motion behavior before implementation.
8. Verify all interaction states, keyboard access, reduced motion, responsive widths, viewport-safe tooltips, and motion smoothness.
9. Test deterministic geometry, scale, tone, formatting, and motion-state helpers. Do not alter formulas or thresholds as part of visual polish.
10. In the completion report, state the question answered, chart selected, interaction and motion behavior, alternative rejected, data caveats, and verification evidence.

### Visualization acceptance gate

A proposed visualization is ready to implement only when all answers below are yes:

- The visual answers a named business question more clearly than plain text or a table alone.
- The compared data has compatible definitions, units, grain, currency, timezone, attribution, and coverage.
- Axes, denominator, baseline, target, and comparison period are explicit where relevant.
- Color meaning follows project semantics and is never the sole carrier of meaning.
- Exact values and essential context remain available without hover.
- Hover, keyboard focus, and touch interactions expose equivalent meaning where the chart is interactive.
- Empty, loading, error, partial, stale, masked, estimated, and unavailable states have an honest treatment.
- Animation has a named purpose, ends at the truthful value, remains interruptible, and has a verified reduced-motion fallback.
- The view remains understandable at 1440px, 1024px, 760px, and 390px without page-level horizontal scrolling.
- The implementation reuses project tokens and existing chart patterns or documents why a new component is necessary.

### Budget progress ring

The Dark dashboard cycle cards now use the approved horizontal meter documented
in `docs/design-system.md`. These geometry rules remain binding on any retained
`ProgressRing` consumer; they do not require replacing the new meter with a ring.

- Zero degrees begins at 12 o'clock and progress moves clockwise.
- The colored arc represents spent divided by budget.
- The current Paid budget design uses a plain rounded endpoint without a charcoal capsule or hover scaling. Other retained ring variants may expose the optional endpoint marker.
- Do not render a separate red 100% notch.
- At exactly 100%, the inner circle is complete.
- Above 100%, keep the inner ring complete and draw excess on the outer orbit as a second lap, with an explicit `+N%` overflow badge and amount.
- Red is used only after the hard 100% budget limit is exceeded.

## Forms and controls

- Every input and select has a persistent visible label.
- Use real `button`, `input`, `select`, and link elements before adding ARIA roles.
- Buttons need explicit `type` unless form submission is intentional.
- Disabled controls must remain readable and explain prerequisites when ambiguity is likely.
- Preserve values and show actionable inline feedback after validation or network failure.

## Accessibility

- Maintain a visible skip link and logical heading order.
- All keyboard-operable controls need visible focus.
- Do not place essential content in an `aria-hidden` tooltip.
- Decorative SVGs must be hidden from assistive technology; meaningful charts need an accessible label or text alternative.
- Use `aria-live` for asynchronous status updates that affect the user.
- Check contrast for text, badges, focus rings, chart marks, and disabled states.
- Respect reduced-motion preferences.

## Responsive behavior

Verify every affected view at approximately 1440px, 1024px, 760px, and 390px.

- Reflow grids before reducing type size.
- Preserve the order of primary insight, supporting evidence, then action.
- Avoid page-level horizontal scrolling. A wide data table may scroll inside a clearly bounded region.
- Tooltips, menus, badges, and sticky controls must remain inside the viewport.
- Touch layouts use at least 44px primary targets.

## Implementation rules

- Prefer extending an existing component or token over creating a near-duplicate.
- Keep data calculation in library modules and visual rendering in components.
- Export and unit-test deterministic geometry or tone helpers used by charts.
- Avoid one-off inline styles for reusable visual behavior.
- Do not silently change metric formulas, status thresholds, currency formatting, or timezone behavior while polishing UI.
- Preserve unrelated work in the working tree.

## Required verification

Before declaring a UI change complete:

1. Run the relevant focused tests.
2. Run TypeScript type checking.
3. Run ESLint on changed source files.
4. Run the full test suite for shared chart, status, token, or calculation changes.
5. Load the affected route in a browser and confirm no framework overlay or console error.
6. Check keyboard focus and at least desktop plus mobile widths.
7. Confirm loading, empty, error, and unavailable states remain understandable.
8. Confirm no new raw component color literals were introduced.

If a check cannot run, report that explicitly; do not imply it passed.

## Definition of done

A change is done only when it **looks like a modern product** and the data meaning is correct, copy is unambiguous, interaction states are covered, accessibility is preserved, responsive behavior is verified, and automated checks pass.

Both halves are required. A screenshot that looks good at one width is not sufficient — and neither is a correct, accessible view that looks like an unstyled admin template. If the visual is not there yet, the change is not done; say so instead of reporting completion.

Placeholder data does not block done, provided it is visibly marked as placeholder.
