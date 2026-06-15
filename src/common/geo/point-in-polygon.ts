export type Position = [number, number]; // [lng, lat]

/** Extrait l'anneau extérieur d'un polygone GeoJSON (ou d'un anneau brut). */
function outerRing(polygon: unknown): Position[] | null {
  if (!polygon) return null;
  // GeoJSON Polygon : { type: 'Polygon', coordinates: [ring, ...holes] }
  if (
    typeof polygon === 'object' &&
    'coordinates' in polygon &&
    Array.isArray((polygon as { coordinates: unknown }).coordinates)
  ) {
    const coords = (polygon as { coordinates: unknown[] }).coordinates;
    const ring = coords[0];
    return isRing(ring) ? ring : null;
  }
  // Tableau d'anneaux : [ring, ...]
  if (Array.isArray(polygon) && isRing(polygon[0])) {
    return polygon[0] as Position[];
  }
  // Anneau brut : [[lng,lat], ...]
  if (isRing(polygon)) return polygon;
  return null;
}

function isRing(value: unknown): value is Position[] {
  return (
    Array.isArray(value) &&
    value.length >= 3 &&
    Array.isArray(value[0]) &&
    typeof (value[0] as unknown[])[0] === 'number'
  );
}

/**
 * Test point-dans-polygone (lancer de rayon). `point` = [lng, lat].
 * Renvoie false si le polygone est absent ou mal formé (repli applicatif assuré
 * par le « quartier le plus proche »).
 */
export function pointInPolygon(point: Position, polygon: unknown): boolean {
  const ring = outerRing(polygon);
  if (!ring) return false;

  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
