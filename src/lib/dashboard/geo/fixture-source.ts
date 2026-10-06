import {
  childLevel,
  GEO_LEVEL_ORDER,
  type GeoCountry,
  type GeoHierarchySource,
  type GeoLevel,
  type GeoPerformanceRow,
  type GeoTarget,
} from "@/lib/dashboard/geo/contract";

/**
 * Synthetic geography. Names are real places so the hierarchy reads sensibly,
 * but every metric is generated. Nothing here comes from a client account.
 *
 * Each country carries its own level labels, which is the whole point of the
 * contract: the same depth is called a provinsi in Indonesia and a negeri in
 * Malaysia, and the UI must not flatten that into "Region".
 *
 * Province names follow the English form Google Ads reports ("West Java"), so
 * the boundary lookup has to bridge them to the local names the map uses.
 */
interface CountryShape {
  code: string;
  name: string;
  labels: GeoCountry["labels"];
  /** province → county → municipality → city → sublocality, three deep max. */
  tree: {
    name: string;
    children: {
      name: string;
      children: { name: string; children: { name: string }[] }[];
    }[];
  }[];
}

const COUNTRY_SHAPES: CountryShape[] = [
  {
    code: "ID",
    name: "Indonesia",
    labels: {
      province: "Provinsi",
      county: "Kabupaten/Kota",
      municipality: "Kecamatan",
      city: "Kota",
      sublocality: "Kelurahan",
    },
    tree: [
      {
        name: "Jakarta",
        children: [
          {
            name: "Jakarta Selatan",
            children: [
              {
                name: "Kebayoran Baru",
                children: [{ name: "Senayan" }, { name: "Gandaria" }],
              },
              { name: "Setiabudi", children: [{ name: "Kuningan" }] },
            ],
          },
          {
            name: "Jakarta Pusat",
            children: [{ name: "Menteng", children: [{ name: "Gondangdia" }] }],
          },
        ],
      },
      {
        name: "West Java",
        children: [
          {
            name: "Bandung",
            children: [{ name: "Coblong", children: [{ name: "Dago" }] }],
          },
          {
            name: "Bekasi",
            children: [
              { name: "Bekasi Selatan", children: [{ name: "Kayuringin" }] },
            ],
          },
        ],
      },
      {
        name: "East Java",
        children: [
          {
            name: "Surabaya",
            children: [{ name: "Gubeng", children: [{ name: "Airlangga" }] }],
          },
          {
            name: "Malang",
            children: [{ name: "Lowokwaru", children: [{ name: "Dinoyo" }] }],
          },
        ],
      },
      {
        name: "Central Java",
        children: [
          {
            name: "Semarang",
            children: [
              { name: "Semarang Tengah", children: [{ name: "Pekunden" }] },
            ],
          },
        ],
      },
      {
        name: "Special Region of Yogyakarta",
        children: [
          {
            name: "Yogyakarta",
            children: [{ name: "Gondokusuman", children: [{ name: "Terban" }] }],
          },
        ],
      },
      {
        name: "Bali",
        children: [
          {
            name: "Denpasar",
            children: [
              { name: "Denpasar Selatan", children: [{ name: "Sanur" }] },
            ],
          },
          {
            name: "Gianyar",
            children: [{ name: "Ubud", children: [{ name: "Peliatan" }] }],
          },
        ],
      },
      {
        name: "Banten",
        children: [
          {
            name: "Tangerang Selatan",
            children: [{ name: "Serpong", children: [{ name: "Lengkong Gudang" }] }],
          },
        ],
      },
      {
        name: "North Sumatra",
        children: [
          {
            name: "Medan",
            children: [{ name: "Medan Baru", children: [{ name: "Petisah Hulu" }] }],
          },
        ],
      },
      {
        name: "South Sulawesi",
        children: [
          {
            name: "Makassar",
            children: [{ name: "Panakkukang", children: [{ name: "Pandang" }] }],
          },
        ],
      },
    ],
  },
  {
    code: "MY",
    name: "Malaysia",
    labels: {
      province: "Negeri",
      county: "Daerah",
      municipality: "Mukim",
      city: "Bandar",
      sublocality: "Kawasan",
    },
    tree: [
      {
        name: "Federal Territory of Kuala Lumpur",
        children: [
          {
            name: "Kuala Lumpur",
            children: [{ name: "Bukit Bintang", children: [{ name: "Pudu" }] }],
          },
        ],
      },
      {
        name: "Selangor",
        children: [
          {
            name: "Petaling",
            children: [
              { name: "Petaling Jaya", children: [{ name: "Damansara" }] },
              { name: "Shah Alam", children: [{ name: "Seksyen 7" }] },
            ],
          },
        ],
      },
      {
        name: "Penang",
        children: [
          {
            name: "Timur Laut",
            children: [{ name: "George Town", children: [{ name: "Jelutong" }] }],
          },
        ],
      },
      {
        name: "Johor",
        children: [
          {
            name: "Johor Bahru",
            children: [{ name: "Johor Bahru", children: [{ name: "Larkin" }] }],
          },
        ],
      },
    ],
  },
  {
    code: "SG",
    name: "Singapore",
    labels: {
      province: "District",
      county: "Planning area",
      municipality: "Subzone",
      city: "City",
      sublocality: "Neighbourhood",
    },
    tree: [
      {
        name: "Central Singapore",
        children: [
          {
            name: "Orchard",
            children: [{ name: "Tanglin", children: [{ name: "Nassim" }] }],
          },
        ],
      },
      {
        name: "South West",
        children: [
          {
            name: "Clementi",
            children: [{ name: "Clementi West", children: [{ name: "West Coast" }] }],
          },
        ],
      },
      {
        name: "North East",
        children: [
          {
            name: "Punggol",
            children: [{ name: "Punggol Field", children: [{ name: "Punggol Point" }] }],
          },
        ],
      },
    ],
  },
];

/** Which markets each brand runs in. The first entry is the home market. */
const ACCOUNT_MARKETS: Record<string, string[]> = {
  "kopi-senja": ["ID", "SG", "MY"],
  "batik-lestari": ["ID", "MY"],
  "rumah-rajut": ["ID", "SG"],
  "jamu-alami": ["ID", "MY"],
  "kriya-bali": ["ID", "SG"],
};

function hash(value: string): number {
  let result = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16_777_619);
  }
  return (result >>> 0) / 4_294_967_296;
}

function targetId(countryCode: string, canonicalName: string): string {
  return `fixture-${countryCode}-${canonicalName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}`;
}

interface FlatTarget extends GeoTarget {
  depthIndex: number;
}

function buildTargets(shape: CountryShape): FlatTarget[] {
  const targets: FlatTarget[] = [];
  const countryCanonical = shape.name;
  const countryId = targetId(shape.code, countryCanonical);

  targets.push({
    id: countryId,
    name: shape.name,
    canonicalName: countryCanonical,
    countryCode: shape.code,
    level: "country",
    parentId: null,
    depthIndex: 0,
  });

  shape.tree.forEach((province, provinceIndex) => {
    const provinceCanonical = `${province.name},${countryCanonical}`;
    const provinceId = targetId(shape.code, provinceCanonical);
    targets.push({
      id: provinceId,
      name: province.name,
      canonicalName: provinceCanonical,
      countryCode: shape.code,
      level: "province",
      parentId: countryId,
      depthIndex: provinceIndex,
      tile: { row: Math.floor(provinceIndex / 3), column: provinceIndex % 3 },
    });

    province.children.forEach((county, countyIndex) => {
      const countyCanonical = `${county.name},${provinceCanonical}`;
      const countyId = targetId(shape.code, countyCanonical);
      targets.push({
        id: countyId,
        name: county.name,
        canonicalName: countyCanonical,
        countryCode: shape.code,
        level: "county",
        parentId: provinceId,
        depthIndex: countyIndex,
        tile: { row: Math.floor(countyIndex / 3), column: countyIndex % 3 },
      });

      county.children.forEach((municipality, municipalityIndex) => {
        const municipalityCanonical = `${municipality.name},${countyCanonical}`;
        const municipalityId = targetId(shape.code, municipalityCanonical);
        targets.push({
          id: municipalityId,
          name: municipality.name,
          canonicalName: municipalityCanonical,
          countryCode: shape.code,
          level: "municipality",
          parentId: countyId,
          depthIndex: municipalityIndex,
          tile: {
            row: Math.floor(municipalityIndex / 3),
            column: municipalityIndex % 3,
          },
        });

        // The tree carries city and one level below it, matching the agreed
        // depth: nothing finer than a borough is modelled.
        const cityCanonical = `${municipality.name} City,${municipalityCanonical}`;
        const cityId = targetId(shape.code, cityCanonical);
        targets.push({
          id: cityId,
          name: `${municipality.name}`,
          canonicalName: cityCanonical,
          countryCode: shape.code,
          level: "city",
          parentId: municipalityId,
          depthIndex: municipalityIndex,
          tile: { row: 0, column: municipalityIndex % 3 },
        });

        municipality.children.forEach((sublocality, sublocalityIndex) => {
          const sublocalityCanonical = `${sublocality.name},${cityCanonical}`;
          targets.push({
            id: targetId(shape.code, sublocalityCanonical),
            name: sublocality.name,
            canonicalName: sublocalityCanonical,
            countryCode: shape.code,
            level: "sublocality",
            parentId: cityId,
            depthIndex: sublocalityIndex,
            tile: {
              row: Math.floor(sublocalityIndex / 3),
              column: sublocalityIndex % 3,
            },
          });
        });
      });
    });
  });

  return targets;
}

const TARGETS_BY_COUNTRY = new Map<string, FlatTarget[]>(
  COUNTRY_SHAPES.map((shape) => [shape.code, buildTargets(shape)]),
);

/** The period the shape constants below are calibrated for. */
const BASELINE_DAYS = 14;

function daysInRange(range: { start: string; end: string }): number {
  const start = Date.parse(`${range.start}T00:00:00Z`);
  const end = Date.parse(`${range.end}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 1;
  return Math.floor((end - start) / 86_400_000) + 1;
}

function metricsFor(
  target: GeoTarget,
  accountSlug: string,
  range: { start: string; end: string },
  scale: number,
): {
  spend: number;
  impressions: number;
  clicks: number;
  registrations: number;
  purchases: number;
  purchaseValue: number;
} {
  const seed = hash(`${accountSlug}|${target.id}|${range.start}|${range.end}`);
  // Volume has to grow with the period, or a quarter would report the same
  // handful of orders as a fortnight and no region could ever clear the
  // volume floor needed to judge its cost per order.
  const periodScale = daysInRange(range) / BASELINE_DAYS;
  const depthDamping = {
    country: 1,
    province: 0.42,
    county: 0.22,
    municipality: 0.13,
    city: 0.1,
    sublocality: 0.05,
  }[target.level];

  // A place's efficiency is its own character, so it is seeded without the
  // range: widening the timeframe must not turn a cheap region into an
  // expensive one. Spread runs either side of the 30 acquisition target so the
  // map has genuine winners and genuine losers rather than one flat verdict.
  const efficiencySeed = hash(`${accountSlug}|${target.id}|efficiency`);
  const costPerOrder = 16 + efficiencySeed * 40;
  const volume = depthDamping * scale * periodScale;
  const spend = Math.round((80 + seed * 520) * volume * 100) / 100;
  const purchases = Math.max(0, Math.round(spend / costPerOrder));
  const registrations = Math.max(
    0,
    Math.round(spend / (costPerOrder / (2.4 + efficiencySeed * 2.2))),
  );
  const purchaseValue =
    Math.round(purchases * (38 + seed * 46) * 100) / 100;
  // Cost per click carries its own tilt, so click-through rate differs between
  // places instead of every region sharing one CTR.
  const costPerClick = 0.22 + efficiencySeed * 0.5;
  const clicks = Math.max(0, Math.round(spend / costPerClick));
  const impressions = Math.max(
    clicks,
    Math.round(clicks / (0.014 + seed * 0.042)),
  );

  return {
    spend,
    impressions,
    clicks,
    registrations,
    purchases,
    purchaseValue,
  };
}

type GeoMetricSet = ReturnType<typeof metricsFor>;

function addMetrics(left: GeoMetricSet, right: GeoMetricSet): GeoMetricSet {
  return {
    spend: left.spend + right.spend,
    impressions: left.impressions + right.impressions,
    clicks: left.clicks + right.clicks,
    registrations: left.registrations + right.registrations,
    purchases: left.purchases + right.purchases,
    purchaseValue: left.purchaseValue + right.purchaseValue,
  };
}

/**
 * A parent's metrics are its children plus a slice that never resolved to any
 * child. Building the tree this way means the levels reconcile: a region can
 * never report less than the places inside it, and the gap the UI reports as
 * unattributed is a real remainder rather than an artefact of two independent
 * random draws.
 */
function rolledUpMetrics(
  target: GeoTarget,
  accountSlug: string,
  range: { start: string; end: string },
  scale: number,
  childrenOf: Map<string | null, GeoTarget[]>,
): GeoMetricSet {
  const children = childrenOf.get(target.id) ?? [];
  const own = metricsFor(target, accountSlug, range, scale);
  if (children.length === 0) return own;

  const summed = children
    .map((child) =>
      rolledUpMetrics(child, accountSlug, range, scale, childrenOf),
    )
    .reduce(addMetrics);

  // 4% to 16% of a level's spend does not resolve to a single child below it.
  const unresolved = 0.04 + hash(`${accountSlug}|${target.id}|unresolved`) * 0.12;
  const inflate = 1 / (1 - unresolved);

  return {
    spend: Math.round(summed.spend * inflate * 100) / 100,
    impressions: Math.round(summed.impressions * inflate),
    clicks: Math.round(summed.clicks * inflate),
    registrations: Math.round(summed.registrations * inflate),
    purchases: Math.round(summed.purchases * inflate),
    purchaseValue: Math.round(summed.purchaseValue * inflate * 100) / 100,
  };
}

export function createFixtureGeoSource(scale = 1): GeoHierarchySource {
  const childrenByCountry = new Map<string, Map<string | null, GeoTarget[]>>();

  function childrenOf(countryCode: string): Map<string | null, GeoTarget[]> {
    const cached = childrenByCountry.get(countryCode);
    if (cached) return cached;

    const map = new Map<string | null, GeoTarget[]>();
    for (const target of TARGETS_BY_COUNTRY.get(countryCode) ?? []) {
      const siblings = map.get(target.parentId);
      if (siblings) siblings.push(target);
      else map.set(target.parentId, [target]);
    }
    childrenByCountry.set(countryCode, map);
    return map;
  }

  return createSource(scale, childrenOf);
}

function createSource(
  scale: number,
  childrenOf: (countryCode: string) => Map<string | null, GeoTarget[]>,
): GeoHierarchySource {
  return {
    sourceId: "fixture",

    listCountries(accountSlug) {
      const markets = ACCOUNT_MARKETS[accountSlug] ?? ["ID"];
      return markets
        .map((code, index) => {
          const shape = COUNTRY_SHAPES.find((item) => item.code === code);
          if (!shape) return null;
          return {
            code: shape.code,
            name: shape.name,
            isPrimary: index === 0,
            labels: shape.labels,
          } satisfies GeoCountry;
        })
        .filter((country): country is GeoCountry => country !== null);
    },

    listTargets(query) {
      const targets = TARGETS_BY_COUNTRY.get(query.countryCode) ?? [];
      return targets.filter(
        (target) =>
          target.level === query.level &&
          (query.parentId === null || target.parentId === query.parentId),
      );
    },

    readPerformance(query) {
      const targets = this.listTargets(query);
      const rows = targets.map((target) => {
        const metrics = rolledUpMetrics(
          target,
          query.accountSlug,
          query.range,
          scale,
          childrenOf(query.countryCode),
        );
        return {
          target,
          ...metrics,
          ctr:
            metrics.impressions === 0
              ? null
              : metrics.clicks / metrics.impressions,
          cpc: metrics.clicks === 0 ? null : metrics.spend / metrics.clicks,
          costPerPurchase:
            metrics.purchases === 0 ? null : metrics.spend / metrics.purchases,
          costPerRegistration:
            metrics.registrations === 0
              ? null
              : metrics.spend / metrics.registrations,
          returnOnAdSpend:
            metrics.spend === 0 ? null : metrics.purchaseValue / metrics.spend,
          spendShare: 0,
        } satisfies GeoPerformanceRow;
      });

      const totalSpend = rows.reduce((total, row) => total + row.spend, 0);

      return rows
        .map((row) => ({
          ...row,
          spendShare: totalSpend === 0 ? 0 : row.spend / totalSpend,
        }))
        .toSorted((left, right) => right.spend - left.spend);
    },
  };
}

/** Levels a country actually reports, so the filter never offers an empty one. */
export function availableLevels(countryCode: string): GeoLevel[] {
  const targets = TARGETS_BY_COUNTRY.get(countryCode) ?? [];
  return GEO_LEVEL_ORDER.filter((level) =>
    targets.some((target) => target.level === level),
  );
}

export { childLevel };
