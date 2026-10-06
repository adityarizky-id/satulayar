-- Consideration signals: dwell time and basket starts, alongside the landing
-- page view that was already here.
--
-- WHY THESE ARE NULLABLE AND STAY NULLABLE
--
-- Availability is a property of an individual ad account's tagging, not of the
-- platform. Meta derives landing page views and basket starts from its pixel
-- on every account; a Google account reports either only once a conversion
-- action of the matching category exists on the site tag, and across the five
-- accounts most do not have one yet. A default of 0 would turn "nobody
-- measured this" into "nobody reached the site", which on an account that is
-- visibly taking orders is a false finding rather than a missing one. So: no
-- `not null`, no default, and the reader maps a stored null straight back to
-- null rather than coercing it to a number.
--
-- WHY numeric AND NOT bigint
--
-- Google reports these through `metrics.all_conversions`, which is credited on
-- a data-driven attribution basis and is therefore fractional: a fourteen-day
-- pull can return figures such as 104.999977 page views or 2.416172 basket
-- starts. `landing_page_views` was created as `bigint` when
-- its only source was Meta's pixel, which counts whole events. Inserting a
-- Google figure into that column rounds each day independently, and fourteen
-- daily roundings do not sum to the rounded total — on a metric whose daily
-- values are small, that error is a visible fraction of the number. Widening
-- to the same `numeric(18, 6)` the conversion columns already use keeps the
-- arithmetic exact and matches how registrations and purchases are stored.
--
-- Widening bigint to numeric preserves every stored value; no backfill needed.

alter table public.daily_metrics
  alter column landing_page_views type numeric(18, 6);

alter table public.daily_metrics
  add column if not exists engaged_visits numeric(18, 6)
    check (engaged_visits >= 0),
  add column if not exists add_to_baskets numeric(18, 6)
    check (add_to_baskets >= 0);

comment on column public.daily_metrics.landing_page_views is
  'Visits where the destination page loaded. Null means the source did not measure it, which is not zero.';

comment on column public.daily_metrics.engaged_visits is
  'Visits that passed the account''s dwell threshold. Google only; Meta has no comparable signal and stores null.';

comment on column public.daily_metrics.add_to_baskets is
  'Baskets started. Google via an ADD_TO_CART conversion action, Meta via the pixel''s add_to_cart.';
