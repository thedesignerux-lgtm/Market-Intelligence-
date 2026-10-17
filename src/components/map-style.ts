// Mapa base: OpenFreeMap (teselas vectoriales de OpenStreetMap, gratuito y sin clave).
// Su estilo incluye la atribución obligatoria «© OpenStreetMap contributors».
export const MAP_STYLE = "https://tiles.openfreemap.org/styles/positron";

// Centro inicial: Santiago de Compostela (zona piloto).
export const DEFAULT_CENTER: [number, number] = [-8.5448, 42.8782];
export const DEFAULT_ZOOM = 12;

// Archivo del worker de MapLibre servido como estático (lo copia scripts/copy-maplibre-worker.mjs).
export const MAPLIBRE_WORKER_URL = "/vendor/maplibre-gl-worker.mjs";
