// Familias de categorías: una capa de presentación sobre las categorías que ya existen.
//
// No son categorías de la base de datos y no se guardan en ninguna parte: solo agrupan lo que
// hay en `categories` para que el selector se lea mejor. Los identificadores, los nombres y la
// relación padre/hijo de las categorías no se tocan.
//
// El reparto va por el prefijo del identificador, que es un camino con puntos
// ("comercio.deporte.ciclismo"), así que una categoría nueva cae sola en su familia.

export interface Category {
  id: string;
  name: string;
  parent_id: string | null;
}

export type FamilyId = "comercio" | "servicios" | "organizaciones" | "comunidades" | "otras";

export interface Family {
  id: FamilyId;
  name: string;
  /** Prefijos de identificador que caen en esta familia. */
  prefixes: string[];
}

export const FAMILIES: Family[] = [
  { id: "comercio", name: "Comercios y distribuidores", prefixes: ["comercio", "distribuidor"] },
  { id: "servicios", name: "Servicios", prefixes: ["servicio"] },
  { id: "organizaciones", name: "Organizaciones deportivas", prefixes: ["club", "asociacion"] },
  { id: "comunidades", name: "Comunidades", prefixes: ["comunidad"] },
  // Red de seguridad: si aparece una categoría con un prefijo nuevo, se ve aquí en lugar
  // de desaparecer del selector.
  { id: "otras", name: "Otras", prefixes: [] },
];

export function familyOf(categoryId: string): FamilyId {
  const root = categoryId.split(".")[0] ?? "";
  return FAMILIES.find((f) => f.prefixes.includes(root))?.id ?? "otras";
}

export interface FamilyGroup extends Family {
  /** Categorías de la familia, cada padre seguido de sus hijas. */
  categories: Category[];
}

/**
 * Agrupa las categorías por familia, manteniendo el orden que trae la consulta y poniendo
 * cada hija justo detrás de su madre. Las familias vacías no se devuelven.
 */
export function groupByFamily(categories: Category[]): FamilyGroup[] {
  const byFamily = new Map<FamilyId, Category[]>();
  const roots = categories.filter((c) => !c.parent_id);
  const childrenOf = (id: string) => categories.filter((c) => c.parent_id === id);
  const push = (category: Category) => {
    const family = familyOf(category.id);
    const list = byFamily.get(family) ?? [];
    list.push(category);
    byFamily.set(family, list);
  };
  for (const root of roots) {
    push(root);
    for (const child of childrenOf(root.id)) push(child);
  }
  // Una categoría cuya madre no está en la lista no debe perderse.
  for (const category of categories) {
    if (category.parent_id && !categories.some((c) => c.id === category.parent_id)) push(category);
  }
  return FAMILIES.map((family) => ({ ...family, categories: byFamily.get(family.id) ?? [] })).filter(
    (family) => family.categories.length > 0,
  );
}

/** Lee el valor del filtro: una o varias categorías separadas por comas. */
export function parseCategories(raw: string | undefined, known: Category[]): string[] {
  const ids = new Set(known.map((c) => c.id));
  const out: string[] = [];
  for (const value of (raw ?? "").split(",").map((v) => v.trim())) {
    if (!value || !ids.has(value) || out.includes(value)) continue;
    out.push(value);
  }
  return out;
}

/**
 * Quita las categorías que ya entran por su madre: la consulta expande una madre a sus hijas,
 * así que mantener las dos solo alarga la URL.
 */
export function collapseCategories(selected: string[], known: Category[]): string[] {
  const parentOf = new Map(known.map((c) => [c.id, c.parent_id] as const));
  return selected.filter((id) => {
    const parent = parentOf.get(id);
    return !parent || !selected.includes(parent);
  });
}

export function serializeCategories(selected: string[]): string | undefined {
  return selected.length > 0 ? [...selected].sort().join(",") : undefined;
}
