// Vocabulario de la interfaz. Un mismo concepto se llama igual en toda la aplicación.

export const ENTITY_TYPE: Record<string, string> = {
  comercio: "Comercio",
  distribuidor: "Distribuidor",
  club: "Club",
  asociacion: "Asociación",
  comunidad: "Comunidad",
};

export const PRECISION: Record<string, { label: string; hint: string }> = {
  exact: { label: "Exacta", hint: "Coordenadas publicadas por la fuente" },
  address: { label: "Portal", hint: "Calculada a partir de la dirección" },
  street: { label: "Calle", hint: "Solo se conoce la calle; posición aproximada" },
  postal_code: { label: "Código postal", hint: "Posición aproximada" },
  municipality: { label: "Municipio", hint: "Posición muy aproximada" },
  unknown: { label: "Sin ubicación", hint: "No aparece en el mapa" },
};

export const SOURCE: Record<string, { short: string; name: string; color: string }> = {
  osm: { short: "OSM", name: "OpenStreetMap", color: "var(--src-osm)" },
  red_galicia: { short: "RED", name: "Rexistro de Entidades Deportivas (Xunta)", color: "var(--src-red)" },
  cartociudad: { short: "IGN", name: "CartoCiudad (IGN)", color: "var(--src-ign)" },
  manual: { short: "Manual", name: "Edición manual", color: "var(--src-manual)" },
};

export const METHOD: Record<string, string> = {
  found: "Publicado por la fuente",
  verified: "Verificado",
  inferred: "Inferido",
  manual: "Introducido a mano",
};

export const FIELD: Record<string, string> = {
  name: "Nombre",
  address: "Dirección",
  postal_code: "Código postal",
  municipality_code: "Municipio",
  location: "Ubicación",
  phone: "Teléfono",
  website: "Web",
  email: "Email",
  opening_hours: "Horario",
};

export const RUN_STATUS: Record<string, string> = {
  queued: "En cola",
  running: "En curso",
  paused: "En pausa",
  succeeded: "Completada",
  partial: "Completada con errores",
  failed: "Fallida",
  cancelled: "Cancelada",
};

export const STATUS: Record<string, string> = {
  active: "Activa",
  unverified: "Sin verificar",
  closed: "Cerrada",
};

export function formatDate(iso: string | null | undefined, withTime = false): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("es-ES", {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
    timeZone: "Europe/Madrid",
  });
}
