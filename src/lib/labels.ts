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

export const PROVINCES: { code: string; name: string }[] = [
  { code: "15", name: "A Coruña" },
  { code: "27", name: "Lugo" },
  { code: "32", name: "Ourense" },
  { code: "36", name: "Pontevedra" },
];

/** Filtro de rol comercial (independiente del estado del CRM). */
export const ROLE_FILTER: Record<string, string> = {
  comprador_potencial: "Compradores potenciales",
  vendedor_potencial: "Vendedores potenciales",
  participante: "Participantes de GROPO",
  comprador_participante: "Compradores participantes",
  vendedor_participante: "Vendedores participantes",
  sin_rol: "Sin rol",
};

export const FOLLOW_FILTER: Record<string, string> = {
  pendiente: "Contactos pendientes",
  primer_contacto: "Primer contacto pendiente",
  seguimiento: "Con próxima acción",
  vencido: "Acciones vencidas",
};

export const PRIORITY: Record<number, { label: string; bg: string; fg: string }> = {
  1: { label: "Alta", bg: "var(--danger-wash)", fg: "var(--danger)" },
  2: { label: "Media", bg: "var(--warn-wash)", fg: "var(--warn)" },
  3: { label: "Baja", bg: "#eef1f0", fg: "var(--ink-soft)" },
};

/** Fecha sin hora ("2026-10-20") → "20 oct 2026". */
export function formatDay(day: string | null | undefined): string {
  if (!day) return "—";
  const [y, m, d] = day.split("-").map(Number);
  if (!y || !m || !d) return day;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** Hoy en España como "AAAA-MM-DD" (las fechas de seguimiento son locales). */
export function todayMadrid(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date());
}
