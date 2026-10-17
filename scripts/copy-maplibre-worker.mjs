// MapLibre carga su web worker desde un archivo aparte. El empaquetador no lo copia,
// así que lo publicamos como estático en /vendor (ver src/components/map-style.ts).
import { copyFileSync, mkdirSync } from "node:fs";
mkdirSync("public/vendor", { recursive: true });
copyFileSync("node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs", "public/vendor/maplibre-gl-worker.mjs");
console.log("maplibre-gl-worker.mjs copiado a public/vendor");
