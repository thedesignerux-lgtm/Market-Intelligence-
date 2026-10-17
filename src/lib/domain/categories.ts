// Traducción de atributos de una fuente a la taxonomía propia (tabla category_mappings).

export interface CategoryMapping {
  sourceId: string;
  match: Record<string, string>;
  categoryId: string;
  entityType: string;
  priority: number;
}

export interface CategoryMatch {
  categoryId: string;
  entityType: string;
  priority: number;
}

/**
 * Devuelve las categorías que encajan, de mayor a menor prioridad (sin repetir).
 * `attributes` puede tener varios valores por clave (p. ej. un club con varias modalidades).
 */
export function matchCategories(
  sourceId: string,
  attributes: Record<string, string | string[] | undefined>,
  mappings: CategoryMapping[],
): CategoryMatch[] {
  const has = (key: string, value: string) => {
    const v = attributes[key];
    if (v === undefined) return false;
    if (Array.isArray(v)) return v.includes(value);
    // En OSM algunas etiquetas llevan varios valores separados por ";" (sport=cycling;running).
    return v === value || v.split(";").map((s) => s.trim()).includes(value);
  };
  const found = new Map<string, CategoryMatch>();
  for (const m of mappings) {
    if (m.sourceId !== sourceId) continue;
    const ok = Object.entries(m.match).every(([k, v]) => has(k, v));
    if (!ok) continue;
    const prev = found.get(m.categoryId);
    if (!prev || prev.priority < m.priority) {
      found.set(m.categoryId, { categoryId: m.categoryId, entityType: m.entityType, priority: m.priority });
    }
  }
  return [...found.values()].sort((a, b) => b.priority - a.priority);
}

/** Claves de etiqueta que hay que pedir a la fuente para cubrir todas las reglas. */
export function requiredOsmFilters(mappings: CategoryMapping[]): string[] {
  const filters = new Set<string>();
  for (const m of mappings) {
    if (m.sourceId !== "osm") continue;
    // osmium tags-filter: basta con el primer par de cada regla; el resto se comprueba después.
    const first = Object.entries(m.match)[0];
    if (first) filters.add(`nwr/${first[0]}=${first[1]}`);
  }
  return [...filters].sort();
}
