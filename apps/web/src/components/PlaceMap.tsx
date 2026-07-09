"use client";

import { useEffect, useRef } from "react";
import "maplibre-gl/dist/maplibre-gl.css";

/**
 * A small embedded map for the place detail modal — MapLibre GL over OSM raster
 * tiles with a single marker. maplibre-gl is imported lazily inside the effect so
 * it never runs during SSR. Renders nothing without coordinates (the caller shows
 * an address + Directions link instead).
 */
export default function PlaceMap({
  lat,
  lng,
  label,
}: {
  lat: number;
  lng: number;
  label?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let map: { remove: () => void } | null = null;
    let cancelled = false;

    (async () => {
      const maplibre = (await import("maplibre-gl")).default;
      if (cancelled || !ref.current) return;
      map = new maplibre.Map({
        container: ref.current,
        style: {
          version: 8,
          sources: {
            osm: {
              type: "raster",
              tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
              tileSize: 256,
              attribution: "© OpenStreetMap contributors",
            },
          },
          layers: [{ id: "osm", type: "raster", source: "osm" }],
        },
        center: [lng, lat],
        zoom: 15,
        attributionControl: { compact: true },
      });
      new maplibre.Marker({ color: "#ffcf33" }).setLngLat([lng, lat]).addTo(map as never);
    })();

    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [lat, lng, label]);

  return <div ref={ref} className="h-44 w-full overflow-hidden rounded-xl border border-line" />;
}
