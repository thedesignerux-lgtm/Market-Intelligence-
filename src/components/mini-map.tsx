"use client";
import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MAPLIBRE_WORKER_URL, MAP_STYLE } from "./map-style";

/** Mapa pequeño de solo lectura para la ficha. Si la posición es aproximada, se dibuja un área en vez de un punto. */
export function MiniMap({ lon, lat, approximate }: { lon: number; lat: number; approximate: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    maplibregl.setWorkerUrl(MAPLIBRE_WORKER_URL);
    const map = new maplibregl.Map({
      container: ref.current,
      style: MAP_STYLE,
      center: [lon, lat],
      zoom: approximate ? 15 : 16,
      interactive: false,
      attributionControl: { compact: true },
    });
    map.on("load", () => {
      map.addSource("p", { type: "geojson", data: { type: "Point", coordinates: [lon, lat] } });
      map.addLayer({
        id: "p",
        type: "circle",
        source: "p",
        paint: approximate
          ? { "circle-radius": 34, "circle-color": "#2d6a4f", "circle-opacity": 0.15, "circle-stroke-color": "#2d6a4f", "circle-stroke-width": 1.5 }
          : { "circle-radius": 7, "circle-color": "#2d6a4f", "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 },
      });
    });
    return () => map.remove();
  }, [lon, lat, approximate]);
  return <div ref={ref} className="h-[200px] w-full overflow-hidden rounded-md border border-line" role="img" aria-label="Ubicación en el mapa" />;
}
