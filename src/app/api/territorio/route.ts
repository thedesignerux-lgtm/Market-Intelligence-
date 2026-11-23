// Datos del selector territorial. Dos modos:
//   /api/territorio?padre=ca12   → hijos de un territorio (sin «padre», las comunidades)
//   /api/territorio?q=arteixo    → búsqueda global en los tres niveles
// Solo lee: devuelve códigos INE, nombres y el número de entidades reales de cada territorio.

import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export interface TerritoryOption {
  code: string;
  level: "ccaa" | "provincia" | "municipio";
  name: string;
  /** Ruta geográfica, solo en la búsqueda: ["Galicia", "A Coruña"]. */
  path?: string[];
  /** Entidades activas con municipio asignado en ese territorio. */
  entities: number;
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session.role) return NextResponse.json({ error: "Sin acceso" }, { status: 401 });

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim();
  const parent = url.searchParams.get("padre")?.trim();
  if (parent && !/^(ca\d{2}|\d{2})$/.test(parent)) {
    return NextResponse.json({ error: "Territorio no válido" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = q
    ? await supabase.rpc("territory_search", { p_q: q.slice(0, 80), p_limit: 30 })
    : await supabase.rpc("territory_options", { p_parent: parent ?? null });

  if (error) return NextResponse.json({ error: "No se pudo leer el territorio" }, { status: 500 });

  const options = ((data as TerritoryOption[] | null) ?? []).map((o) => ({
    code: o.code,
    level: o.level,
    name: o.name,
    path: o.path?.filter(Boolean),
    entities: Number(o.entities ?? 0),
  }));
  return NextResponse.json({ options }, { headers: { "Cache-Control": "private, max-age=60" } });
}
