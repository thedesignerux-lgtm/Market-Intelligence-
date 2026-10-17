"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, MapGeoJSONFeature, MapLayerMouseEvent } from "maplibre-gl";
import type { Feature, Point } from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";
import { DEFAULT_CENTER, DEFAULT_ZOOM, MAPLIBRE_WORKER_URL, MAP_STYLE } from "@/components/map-style";
import { createClient } from "@/lib/supabase/client";

interface Props {
  workspaceId: string;
  focus: { id: string; lon: number; lat: number; name: string } | null;
  statuses: { slug: string; label: string }[];
}

type LoadState = { kind: "idle" | "loading" } | { kind: "ok"; total: number; clustered: boolean } | { kind: "error"; message: string };

const EMPTY = { type: "FeatureCollection" as const, features: [] };

export function MapView({ workspaceId, focus, statuses }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const reqId = useRef(0);
  const [types, setTypes] = useState<string>("");
  const [crm, setCrm] = useState<string>("");
  const [state, setState] = useState<LoadState>({ kind: "idle" });
  const router = useRouter();
  const filters = useRef({ types, crm });
  filters.current = { types, crm };

  const load = useCallback(async () => {
    const map = mapRef.current;
    if (!map) return;
    const b = map.getBounds();
    const id = ++reqId.current;
    setState({ kind: "loading" });
    const supabase = createClient();
    const { data, error } = await supabase.rpc("map_features", {
      p_workspace: workspaceId,
      p_west: b.getWest(),
      p_south: b.getSouth(),
      p_east: b.getEast(),
      p_north: b.getNorth(),
      p_zoom: Math.round(map.getZoom()),
      p_types: filters.current.types ? [filters.current.types as "comercio"] : undefined,
      p_crm_status: filters.current.crm || undefined,
    });
    if (id !== reqId.current) return; // llegó tarde: hay otra petición más reciente
    if (error) {
      setState({ kind: "error", message: "No se pudieron cargar los puntos. Mueve el mapa para reintentar." });
      return;
    }
    const fc = data as { features: Feature[]; total?: number; clustered?: boolean; error?: string };
    if (fc.error) {
      setState({ kind: "ok", total: 0, clustered: false });
      (map.getSource("entities") as GeoJSONSource | undefined)?.setData(EMPTY);
      return;
    }
    (map.getSource("entities") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: fc.features });
    setState({ kind: "ok", total: fc.total ?? fc.features.length, clustered: Boolean(fc.clustered) });
  }, [workspaceId]);

  useEffect(() => {
    if (!container.current) return;
    maplibregl.setWorkerUrl(MAPLIBRE_WORKER_URL);
    const map = new maplibregl.Map({
      container: container.current,
      style: MAP_STYLE,
      center: focus ? [focus.lon, focus.lat] : DEFAULT_CENTER,
      zoom: focus ? 16 : DEFAULT_ZOOM,
      attributionControl: { compact: false },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    map.on("load", () => {
      map.addSource("entities", { type: "geojson", data: EMPTY });
      // Agrupaciones: círculo con el número de entidades.
      map.addLayer({
        id: "clusters",
        type: "circle",
        source: "entities",
        filter: ["has", "count"],
        paint: {
          "circle-color": "#17282c",
          "circle-opacity": 0.85,
          "circle-radius": ["interpolate", ["linear"], ["get", "count"], 2, 14, 50, 22, 500, 32],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
        },
      });
      map.addLayer({
        id: "cluster-count",
        type: "symbol",
        source: "entities",
        filter: ["has", "count"],
        layout: { "text-field": ["to-string", ["get", "count"]], "text-size": 12, "text-font": ["Noto Sans Bold"] },
        paint: { "text-color": "#ffffff" },
      });
      // Entidades individuales: comercio en verde pino, club en azul atlántico; "No contactar" con aro rojo.
      map.addLayer({
        id: "points",
        type: "circle",
        source: "entities",
        filter: ["!", ["has", "count"]],
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 4, 16, 8],
          "circle-color": ["match", ["get", "entity_type"], "comercio", "#2d6a4f", "club", "#245b8c", "#566a6d"],
          "circle-stroke-color": ["case", ["==", ["get", "crm_status"], "no_contactar"], "#a8322a", "#ffffff"],
          "circle-stroke-width": ["case", ["==", ["get", "crm_status"], "no_contactar"], 3, 1.5],
        },
      });

      map.on("click", "clusters", (ev: MapLayerMouseEvent) => {
        const f = ev.features?.[0] as MapGeoJSONFeature | undefined;
        const bbox = f?.properties?.bbox ? (JSON.parse(f.properties.bbox) as [number, number, number, number]) : null;
        if (bbox) map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 60, maxZoom: 16 });
      });
      map.on("click", "points", (ev: MapLayerMouseEvent) => {
        const f = ev.features?.[0] as MapGeoJSONFeature | undefined;
        if (!f) return;
        const coords = (f.geometry as Point).coordinates as [number, number];
        openPopup(map, coords, String(f.properties.id), String(f.properties.name), router);
      });
      for (const layer of ["clusters", "points"]) {
        map.on("mouseenter", layer, () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", layer, () => (map.getCanvas().style.cursor = ""));
      }
      map.on("moveend", load);
      load();
      if (focus) openPopup(map, [focus.lon, focus.lat], focus.id, focus.name, router);
    });

    return () => map.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (mapRef.current?.isStyleLoaded()) load();
  }, [types, crm, load]);

  return (
    <div className="relative h-[calc(100dvh-57px)] md:h-dvh">
      {/* MapLibre fuerza position:relative en su contenedor: el posicionamiento absoluto va en un envoltorio. */}
      <div className="absolute inset-0">
        <div ref={container} className="h-full w-full" />
      </div>
      <div className="absolute left-3 top-3 z-10 flex max-w-[calc(100%-64px)] flex-wrap items-end gap-2 rounded-lg border border-line bg-surface/95 p-3 shadow-[0_1px_2px_rgba(23,40,44,0.08)]">
        <label className="flex flex-col gap-1">
          <span className="label">Tipo</span>
          <select className="field" value={types} onChange={(e) => setTypes(e.target.value)}>
            <option value="">Todos</option>
            <option value="comercio">Comercios</option>
            <option value="club">Clubes</option>
            <option value="asociacion">Asociaciones</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="label">Estado comercial</span>
          <select className="field" value={crm} onChange={(e) => setCrm(e.target.value)}>
            <option value="">Todos</option>
            <option value="sin_estado">Sin estado</option>
            {statuses.map((s) => (
              <option key={s.slug} value={s.slug}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <p className="min-w-[150px] pb-2 text-[13px] text-ink-soft" aria-live="polite">
          {state.kind === "loading" && "Cargando…"}
          {state.kind === "ok" &&
            (state.total === 0
              ? "Nada en esta zona"
              : `${state.total} ${state.total === 1 ? "entidad" : "entidades"} en la vista${state.clustered ? ", agrupadas" : ""}`)}
          {state.kind === "error" && <span className="text-danger">{state.message}</span>}
        </p>
      </div>
      <div className="absolute bottom-8 left-3 z-10 flex gap-3 rounded-md bg-surface/95 px-3 py-2 text-[12px] text-ink-soft">
        <span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-full bg-pine" />Comercio</span>
        <span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-full bg-atlantic" />Club</span>
        <span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-full border-2 border-danger" />No contactar</span>
      </div>
    </div>
  );
}

function openPopup(map: maplibregl.Map, coords: [number, number], id: string, name: string, router: ReturnType<typeof useRouter>) {
  // Contenido construido con nodos de texto (nunca HTML): evita inyección desde los datos.
  const box = document.createElement("div");
  box.className = "flex flex-col gap-1 font-sans";
  const title = document.createElement("strong");
  title.className = "text-[14px] text-ink";
  title.textContent = name;
  const link = document.createElement("a");
  link.href = `/entidades/${id}`;
  link.className = "text-[13px] text-atlantic underline";
  link.textContent = "Abrir ficha";
  link.addEventListener("click", (ev) => {
    ev.preventDefault();
    router.push(`/entidades/${id}`);
  });
  box.append(title, link);
  new maplibregl.Popup({ closeButton: true, offset: 10 }).setLngLat(coords).setDOMContent(box).addTo(map);
}
