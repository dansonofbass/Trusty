/**
 * Geo helpers — great-circle distance for "near me" ranking of place nodes.
 * Pure + deterministic; the trust engine stays geo-string based, distance is
 * layered on top server-side.
 */
export interface LatLng {
  lat: number;
  lng: number;
}

const toRad = (d: number): number => (d * Math.PI) / 180;

/** Great-circle distance between two WGS84 points, in kilometres. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371; // mean Earth radius (km)
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}
