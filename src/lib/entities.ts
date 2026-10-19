import "server-only";
import { ENTITY_TYPE, FOLLOW_FILTER, PROVINCES, ROLE_FILTER } from "./labels";
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
  categoria?: string;
  provincia?: string;
  municipio?: string;
  estado?: string;
  prioridad?: string;
  rol?: string;
  seguimiento?: string;
}

export function readFilters(sp: Params): EntityFilters {
  const prioridad = one(sp.prioridad);
  // «territorio» (selector único) acepta una provincia (2 cifras) o un municipio (5 cifras).
  const territorio = one(sp.territorio);
  const provincia = territorio?.length === 2 ? territorio : territorio ? undefined : one(sp.provincia);
  const municipio = territorio?.length === 5 ? territorio : territorio ? undefined : one(sp.municipio);
  const tipo = one(sp.tipo);
  const rol = one(sp.rol);
  const seguimiento = one(sp.seguimiento);
  const estado = one(sp.estado);
  const categoria = one(sp.categoria);
  return {
    q: one(sp.q)?.slice(0, 120),
    tipo: tipo && tipo in ENTITY_TYPE ? tipo : undefined,
    categoria: categoria && /^[a-z.]{2,80}$/.test(categoria) ? categoria : undefined,
    provincia: provincia && PROVINCES.some((p) => p.code === provincia) ? provincia : undefined,
    municipio: municipio && /^\d{5}$/.test(municipio) ? municipio : undefined,
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
  const { data, error } = await supabase.rpc("search_entities", {
    p_workspace: session.workspaceId!,
    p_q: f.q,
    p_types: f.tipo ? [f.tipo as "comercio"] : undefined,
    p_category: f.categoria,
    p_province: f.provincia,
    p_municipality: f.municipio,
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
