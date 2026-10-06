import { REGION_SHAPES } from "@/lib/dashboard/geo/region-shapes";

/**
 * Matches a geo target to a boundary shape.
 *
 * Names never line up perfectly between an ads platform and a boundary set:
 * Google says "West Java" where Natural Earth says "Jawa Barat". Rather
 * than guess with fuzzy matching, this resolves in three explicit steps and
 * returns null when it genuinely cannot match, so the map degrades to tiles
 * instead of drawing the wrong region.
 */

/** Deliberate one-to-many mappings, and names that differ outright. */
const REGION_ALIASES: Record<string, Record<string, string[]>> = {
  // Google Ads reports Indonesian provinces in English; Natural Earth keeps
  // the Indonesian names.
  ID: {
    jakarta: ["Jakarta Raya"],
    "dki jakarta": ["Jakarta Raya"],
    "west java": ["Jawa Barat"],
    "central java": ["Jawa Tengah"],
    "east java": ["Jawa Timur"],
    "special region of yogyakarta": ["Yogyakarta"],
    "north sumatra": ["Sumatera Utara"],
    "south sumatra": ["Sumatera Selatan"],
    "west sumatra": ["Sumatera Barat"],
    "south sulawesi": ["Sulawesi Selatan"],
    "north sulawesi": ["Sulawesi Utara"],
    "east kalimantan": ["Kalimantan Timur"],
    "riau islands": ["Kepulauan Riau"],
    "west nusa tenggara": ["Nusa Tenggara Barat"],
    "east nusa tenggara": ["Nusa Tenggara Timur"],
    // A metropolitan area that spans several provinces joins their shapes.
    jabodetabek: ["Jakarta Raya", "Jawa Barat", "Banten"],
  },
  MY: {
    "federal territory of kuala lumpur": ["Kuala Lumpur"],
    "federal territory of putrajaya": ["Putrajaya"],
    "federal territory of labuan": ["Labuan"],
    penang: ["Pulau Pinang"],
    malacca: ["Melaka"],
  },
};

/** Suffixes that carry no identity, only the local word for the level. */
const STRIPPED_SUFFIXES = [" county", " province"];

export function normaliseRegionName(name: string): string {
  const base = name
    .normalize("NFD")
    // Strip diacritics so an accented spelling matches its plain form.
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  for (const suffix of STRIPPED_SUFFIXES) {
    if (base.endsWith(suffix)) return base.slice(0, -suffix.length).trim();
  }

  return base;
}

/** Alias keys are normalised once, so a key written naturally still matches. */
const NORMALISED_ALIASES: Record<string, Record<string, string[]>> =
  Object.fromEntries(
    Object.entries(REGION_ALIASES).map(([country, aliases]) => [
      country,
      Object.fromEntries(
        Object.entries(aliases).map(([key, targets]) => [
          normaliseRegionName(key),
          targets,
        ]),
      ),
    ]),
  );

/** Possessive forms ending in "s" against a boundary set's bare name. */
function withoutPossessive(value: string): string {
  return value.endsWith("s") ? value.slice(0, -1) : value;
}

export function countryShapeSet(countryCode: string) {
  return REGION_SHAPES[countryCode] ?? null;
}

/**
 * Returns the SVG path for a region, joining several shapes when the platform's
 * region covers more than one boundary feature.
 */
export function resolveRegionPath(
  countryCode: string,
  regionName: string,
): string | null {
  const set = REGION_SHAPES[countryCode];
  if (!set) return null;

  const direct = set.regions[regionName];
  if (direct) return direct;

  const wanted = normaliseRegionName(regionName);
  const aliases = NORMALISED_ALIASES[countryCode];
  const aliasTargets =
    aliases?.[wanted] ?? aliases?.[withoutPossessive(wanted)];

  if (aliasTargets) {
    const joined = aliasTargets
      .map((target) => set.regions[target])
      .filter((path): path is string => Boolean(path))
      .join("");
    return joined.length > 0 ? joined : null;
  }

  const entry = Object.entries(set.regions).find(([name]) => {
    const candidate = normaliseRegionName(name);
    return (
      candidate === wanted ||
      withoutPossessive(candidate) === withoutPossessive(wanted)
    );
  });

  return entry?.[1] ?? null;
}

export function hasShapesFor(countryCode: string): boolean {
  return REGION_SHAPES[countryCode] !== undefined;
}
