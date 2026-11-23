import "server-only";
import { parseTerritory, serializeTerritory, territoryQuery } from "./domain/territory-selection";
import { ENTITY_TYPE, FOLLOW_FILTER, ROLE_FILTER } from "./labels";
import type { AppSession } from "./session";
import type { createClient } from "./supabase/server";

/** Fila devuelta por search_entities. */
export interface EntityRow {
  id: string;
  entity_type: string;
  name: string;
  category_id: string | null;
  category_name: string | null;
  municipality_code: string | null;
  municipality_name: string | null;
  province_name: string | null;
  location_precision: string;
  status: string;
  crm_status: string | null;
  crm_status_label: string | null;
  priority: number | null;
  next_action: string | null;
  next_action_at: string | null;
  buyer_potential: boolean;
  seller_potential: boolean;
  buyer_participant: boolean;
  seller_participant: boolean;
  has_contact: boolean;
  contact_blocked: boolean;
  sources: string[] | null;
  score: number | null;
  sort_key: string;
}

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;

/** Filtros del directorio leídos de la URL y validados (los valores desconocidos se ignoran). */
export interface EntityFilters {
  q?: string;
  tipo?: string;
  /** Una o varias categorías separadas por comas. Vacío = todas. */
  categoria?: string;
  /** Selección territorial serializada: "ca12,28,-28079". Vacío = toda España. */
  territorio?: string;
  estado?: string;
  prioridad?: string;
  rol?: string;
  seguimiento?: string;
}

export function readFilters(sp: Params): EntityFilters {
  const prioridad = one(sp.prioridad);
  // «territorio» admite comunidades, provincias y municipios separados por comas, con "-" para
  // excluir. Se siguen aceptando los antiguos «provincia» y «municipio» (enlaces de cobertura).
  const picks = parseTerritory([sp.territorio, sp.provincia, sp.municipio].flat() as string[]);
  const tipo = one(sp.tipo);
  const rol = one(sp.rol);
  const seguimiento = one(sp.seguimiento);
  const estado = one(sp.estado);
  // «categoria» admite varias separadas por comas. Las que no existan las ignora la consulta;
  // quitar las redundantes (una hija cuya madre también está marcada) es cosa del selector,
  // que es quien sabe la relación madre/hija.
  const categoria = one(sp.categoria);
  return {
    q: one(sp.q)?.slice(0, 120),
    tipo: tipo && tipo in ENTITY_TYPE ? tipo : undefined,
    categoria: categoria && /^[a-z.]{2,80}(,[a-z.]{2,80})*$/.test(categoria) ? categoria : undefined,
    territorio: serializeTerritory(picks),
    estado: estado && /^[a-z_]{2,40}$/.test(estado) ? estado : undefined,
    prioridad: prioridad && ["1", "2", "3"].includes(prioridad) ? prioridad : undefined,
    rol: rol && rol in ROLE_FILTER ? rol : undefined,
    seguimiento: seguimiento && seguimiento in FOLLOW_FILTER ? seguimiento : undefined,
  };
}

export function filtersToParams(f: EntityFilters): URLSearchParams {
  return new URLSearchParams(Object.entries(f).filter((e): e is [string, string] => Boolean(e[1])));
}

export async function searchEntities(
  supabase: Awaited<ReturnType<typeof createClient>>,
  session: AppSession,
  f: EntityFilters,
  opts: { limit: number; cursor?: { score?: number; key?: string; id?: string } },
) {
  const territory = territoryQuery(parseTerritory(f.territorio));
  const { data, error } = await supabase.rpc("search_entities", {
    p_workspace: session.workspaceId!,
    p_q: f.q,
    p_types: f.tipo ? [f.tipo as "comercio"] : undefined,
    p_categories: f.categoria ? f.categoria.split(",") : undefined,
    p_provinces: territory.provinces.length ? territory.provinces : undefined,
    p_municipalities: territory.municipalities.length ? territory.municipalities : undefined,
    p_exclude_municipalities: territory.excluded.length ? territory.excluded : undefined,
    p_crm_status: f.estado,
    p_priority: f.prioridad ? Number(f.prioridad) : undefined,
    p_role: f.rol,
    p_follow: f.seguimiento,
    p_limit: opts.limit,
    p_after_score: opts.cursor?.score,
    p_after_key: opts.cursor?.key,
    p_after_id: opts.cursor?.id,
  });
  return { rows: (data as EntityRow[] | null) ?? [], error };
}

/**
 * Nombres de los territorios seleccionados, para los chips del selector.
 * Se resuelven en el servidor: así los chips tienen nombre desde el primer pintado,
 * incluso cuando la selección llega en la URL y el navegador aún no ha pedido nada.
 */
export async function territoryLabels(
  supabase: Awaited<ReturnType<typeof createClient>>,
  territorio?: string,
): Promise<Record<string, string>> {
  const codes = parseTerritory(territorio).map((p) => p.code);
  if (codes.length === 0) return {};
  const { data } = await supabase.from("admin_areas").select("code, name").in("code", codes);
  return Object.fromEntries(((data as { code: string; name: string }[] | null) ?? []).map((r) => [r.code, r.name]));
}
