import fs from "node:fs";

/**
 * Extracts Natural Earth admin-1 boundaries for the three markets the fixture
 * covers, simplifies them, and emits SVG paths as a TypeScript module.
 *
 * Natural Earth is public domain, so the output can live in the repository.
 * Nothing here runs at request time: this is a one-off build step whose output
 * is committed.
 */

const SOURCE = process.argv[2];
const OUTPUT = process.argv[3];

/** How each country's admin-1 features roll up to the fixture's province level. */
const COUNTRY_GROUPING = {
  ID: (properties) => properties.name,
  MY: (properties) => properties.name,
  SG: (properties) => properties.name,
};

const WIDTH = 1000;
const HEIGHT = 620;
const PADDING = 12;
/** Coordinate precision after projection, in SVG units. */
const PRECISION = 1;
/** Rings smaller than this share of the country's bounding box are dropped. */
const MIN_RING_SHARE = 0.00025;

function ringsOf(geometry) {
  if (geometry.type === "Polygon") return geometry.coordinates;
  if (geometry.type === "MultiPolygon") return geometry.coordinates.flat();
  return [];
}

function boundsOf(features) {
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;

  for (const feature of features) {
    for (const ring of ringsOf(feature.geometry)) {
      for (const [lon, lat] of ring) {
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
    }
  }

  return { minLon, maxLon, minLat, maxLat };
}

function makeProjection(bounds) {
  const midLat = ((bounds.minLat + bounds.maxLat) / 2) * (Math.PI / 180);
  // Longitude degrees shrink towards the poles, so scale them by cos(lat) or
  // northern countries come out stretched sideways.
  const lonScale = Math.cos(midLat);
  const spanX = (bounds.maxLon - bounds.minLon) * lonScale;
  const spanY = bounds.maxLat - bounds.minLat;
  const scale = Math.min(
    (WIDTH - PADDING * 2) / spanX,
    (HEIGHT - PADDING * 2) / spanY,
  );
  const offsetX = (WIDTH - spanX * scale) / 2;
  const offsetY = (HEIGHT - spanY * scale) / 2;

  return ([lon, lat]) => [
    offsetX + (lon - bounds.minLon) * lonScale * scale,
    offsetY + (bounds.maxLat - lat) * scale,
  ];
}

function ringArea(points) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const [x1, y1] = points[index];
    const [x2, y2] = points[(index + 1) % points.length];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area / 2);
}

function simplify(points, tolerance) {
  if (points.length <= 4) return points;
  const kept = [points[0]];

  for (const point of points.slice(1)) {
    const last = kept[kept.length - 1];
    if (
      Math.abs(point[0] - last[0]) >= tolerance ||
      Math.abs(point[1] - last[1]) >= tolerance
    ) {
      kept.push(point);
    }
  }

  if (kept.length < 4) return points;
  return kept;
}

function toPath(features, projection, tolerance) {
  const commands = [];

  for (const feature of features) {
    const rings = ringsOf(feature.geometry).map((ring) => ring.map(projection));
    const largest = rings.reduce(
      (best, ring) => (best && ringArea(best) >= ringArea(ring) ? best : ring),
      null,
    );

    for (const projected of rings) {
      const area = ringArea(projected);
      // Small provinces (a capital city region, say) would otherwise vanish on
      // a wide country, so each feature always keeps its largest ring.
      if (area < WIDTH * HEIGHT * MIN_RING_SHARE && projected !== largest) continue;

      const thinned = simplify(projected, tolerance).map(([x, y]) => [
        Number(x.toFixed(PRECISION)),
        Number(y.toFixed(PRECISION)),
      ]);
      if (thinned.length < 4) continue;

      commands.push(
        `M${thinned[0][0]} ${thinned[0][1]}` +
          thinned
            .slice(1)
            .map(([x, y]) => `L${x} ${y}`)
            .join("") +
          "Z",
      );
    }
  }

  return commands.join("");
}

const geo = JSON.parse(fs.readFileSync(SOURCE, "utf8"));
const output = {};

for (const [iso, groupOf] of Object.entries(COUNTRY_GROUPING)) {
  const features = geo.features.filter(
    (feature) => feature.properties.iso_a2 === iso,
  );
  if (features.length === 0) continue;

  const bounds = boundsOf(features);
  const projection = makeProjection(bounds);
  const groups = new Map();

  for (const feature of features) {
    const key = groupOf(feature.properties);
    if (!key) continue;
    const bucket = groups.get(key) ?? [];
    bucket.push(feature);
    groups.set(key, bucket);
  }

  const regions = {};
  for (const [name, groupFeatures] of groups) {
    const path = toPath(groupFeatures, projection, 1.1);
    if (path.length === 0) continue;
    regions[name] = path;
  }

  output[iso] = { viewBox: `0 0 ${WIDTH} ${HEIGHT}`, regions };
}

const header = `/**
 * Administrative boundaries for the markets this dashboard covers.
 *
 * Source: Natural Earth admin-1 states and provinces, 1:10m.
 * Natural Earth is in the public domain, so these paths ship with the app.
 * Generated once by scripts/build-region-shapes.mjs and committed; nothing
 * downloads geometry at request time.
 *
 * Shapes are simplified for display. They are not survey-grade boundaries and
 * must not be used to decide what a campaign targets.
 */

export interface CountryShapeSet {
  viewBox: string;
  regions: Record<string, string>;
}

export const REGION_SHAPES: Record<string, CountryShapeSet> = `;

fs.writeFileSync(
  OUTPUT,
  `${header}${JSON.stringify(output, null, 0)};\n`,
  "utf8",
);

const bytes = fs.statSync(OUTPUT).size;
console.log(
  `wrote ${OUTPUT} (${(bytes / 1024).toFixed(0)} KB)\n` +
    Object.entries(output)
      .map(([iso, set]) => `  ${iso}: ${Object.keys(set.regions).length} regions`)
      .join("\n"),
);
