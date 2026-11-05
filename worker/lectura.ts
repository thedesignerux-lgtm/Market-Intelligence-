// ¿Estamos leyendo lo que creemos que estamos leyendo?
//
// Todas las tablas tienen RLS y sus políticas se escribieron para el rol `authenticated` de
// Supabase. Un rol de solo lectura creado a mano no las cumple, y entonces las consultas
// **no fallan: devuelven cero filas**. La previsualización saldría con 0 candidatos y
// parecería correcta.
//
// Ese es el fallo peligroso: es silencioso. Esta comprobación lo convierte en un error ruidoso.

import type { Db } from "./db";

export class LecturaNoGarantizada extends Error {}

interface Diagnostico {
  usuario: string;
  superusuario: boolean;
  bypassrls: boolean;
  /** Tablas con RLS activa cuyas filas podrían estar filtrándose sin avisar. */
  tablasFiltradas: string[];
  mappingsOsm: number;
}

/** Tablas sin las cuales la previsualización no puede dar un resultado con sentido. */
const IMPRESCINDIBLES = ["category_mappings", "entities", "contact_points", "source_records", "entity_sources"];

export async function diagnosticarLectura(db: Db): Promise<Diagnostico> {
  const { rows: quien } = await db.query<{ usuario: string; superusuario: boolean; bypassrls: boolean }>(
    `select current_user as usuario,
            coalesce((select rolsuper from pg_roles where rolname = current_user), false) as superusuario,
            coalesce((select rolbypassrls from pg_roles where rolname = current_user), false) as bypassrls`,
  );
  const yo = quien[0]!;

  // Una tabla filtra si tiene RLS activa y no somos ni su dueño, ni superusuario, ni bypassrls.
  const { rows: tablas } = await db.query<{ relname: string }>(
    `select c.relname
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
        and c.relname = any($1::text[])
        and pg_get_userbyid(c.relowner) <> current_user`,
    [IMPRESCINDIBLES],
  );

  const { rows: m } = await db.query<{ n: number }>(
    `select count(*)::int as n from public.category_mappings where source_id = 'osm'`,
  );

  return {
    usuario: yo.usuario,
    superusuario: yo.superusuario,
    bypassrls: yo.bypassrls,
    tablasFiltradas: yo.superusuario || yo.bypassrls ? [] : tablas.map((t) => t.relname),
    mappingsOsm: m[0]!.n,
  };
}

/**
 * Se detiene si no puede garantizar que está leyendo los datos esperados.
 * Prefiere parar a entregar un informe vacío que parezca correcto.
 */
export async function garantizarLectura(db: Db): Promise<Diagnostico> {
  const d = await diagnosticarLectura(db);

  if (d.tablasFiltradas.length > 0) {
    throw new LecturaNoGarantizada(
      `El rol «${d.usuario}» no puede ver todas las filas: RLS está activa en ` +
        `${d.tablasFiltradas.join(", ")} y este rol no la elude.\n` +
        `Las consultas no fallarían: devolverían cero filas y el informe saldría vacío pareciendo correcto.\n` +
        `Solución: alter role ${d.usuario} bypassrls;  (no concede ninguna escritura)`,
    );
  }

  if (d.mappingsOsm === 0) {
    throw new LecturaNoGarantizada(
      `No se ve ninguna regla de categorías para la fuente «osm» en category_mappings.\n` +
        `Sin reglas no se puede clasificar nada y el resultado sería 0 candidatos.\n` +
        `Puede ser una base sin migrar, o un rol que no ve las filas (RLS).`,
    );
  }

  return d;
}

export function resumenLectura(d: Diagnostico): string {
  const como = d.superusuario ? "superusuario" : d.bypassrls ? "con bypassrls" : "sin privilegios especiales";
  return `  lectura: rol «${d.usuario}» (${como}) · ${d.mappingsOsm} reglas de categorías osm visibles`;
}
