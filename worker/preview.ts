// Previsualización de una importación: dice qué pasaría sin escribir nada.
//
// Usa exactamente las mismas reglas de emparejamiento que la ingesta real (findCandidates +
// scoreMatch de worker/pipeline.ts). No reimplementa la deduplicación: si la previsualización
// y la carga difieren, es un error, no una diferencia de criterio.
//
// Todo lo que hace es leer. No escribe en ninguna tabla.

import type { Db } from "./db";
import { findCandidates, toCandidate } from "./pipeline";
import {
  DEFAULT_MATCH_CONFIG,
  scoreMatch,
  type MatchCandidate,
  type MatchConfig,
} from "../src/lib/domain/matching";
import type { NormalizedRecord } from "../src/lib/domain/records";

export type Clase = "nueva" | "existente" | "duplicado" | "descartada";

export interface FilaPrevia {
  externalId: string;
  nombre: string;
  clase: Clase;
  /** Por qué ha caído en esa clase, en lenguaje llano. */
  motivo: string;
  /** Entidad con la que se emparejaría, si la hay. */
  entidad?: { id: string; nombre: string; puntuacion: number };
  contactos: { telefono: number; email: number; web: number };
}

export interface Descartada {
  externalId: string;
  nombre: string;
  motivo: string;
}

export interface InformePrevio {
  fuente: string;
  total: number;
  nuevas: FilaPrevia[];
  existentes: FilaPrevia[];
  duplicados: FilaPrevia[];
  descartadas: Descartada[];
  contactos: {
    conAlgunCanal: number;
    telefono: number;
    email: number;
    web: number;
    sinNingunCanal: number;
  };
}

/**
 * Los registros ya vistos de esta importación, indexados igual que los preselecciona
 * `findCandidates()`: por celda geográfica (para el radio de 1 km) y por municipio + nombre.
 * Así la previsualización encuentra los mismos choques que encontrará la ingesta, sin
 * comparar todos contra todos.
 */
class Lote {
  /** Celdas de ~1,1 km: un punto solo se compara con su celda y las 8 vecinas. */
  private static readonly CELDA = 0.01;
  private porCelda = new Map<string, { r: NormalizedRecord; c: MatchCandidate }[]>();
  private porMunicipio = new Map<string, { r: NormalizedRecord; c: MatchCandidate }[]>();

  private static celda(lon: number, lat: number): string {
    return `${Math.floor(lon / Lote.CELDA)}:${Math.floor(lat / Lote.CELDA)}`;
  }

  private vecinos(c: MatchCandidate, r: NormalizedRecord): { r: NormalizedRecord; c: MatchCandidate }[] {
    const out: { r: NormalizedRecord; c: MatchCandidate }[] = [];
    if (c.location) {
      const [lon, lat] = c.location;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const k = Lote.celda(lon + dx * Lote.CELDA, lat + dy * Lote.CELDA);
          const v = this.porCelda.get(k);
          if (v) out.push(...v);
        }
      }
    }
    if (r.municipalityCode) {
      const v = this.porMunicipio.get(r.municipalityCode);
      if (v) out.push(...v.filter((x) => !out.includes(x)));
    }
    return out;
  }

  /** Primer registro ya visto que se emparejaría con este, o null. */
  choque(r: NormalizedRecord, c: MatchCandidate, config: MatchConfig) {
    let mejor: { externalId: string; nombre: string; puntuacion: number; decision: string } | null = null;
    for (const otro of this.vecinos(c, r)) {
      const res = scoreMatch(c, otro.c, config);
      if (res.decision === "different") continue;
      if (!mejor || res.score > mejor.puntuacion) {
        mejor = { externalId: otro.r.externalId, nombre: otro.r.name, puntuacion: res.score, decision: res.decision };
      }
    }
    return mejor;
  }

  añadir(r: NormalizedRecord, c: MatchCandidate) {
    const e = { r, c };
    if (c.location) {
      const k = Lote.celda(c.location[0], c.location[1]);
      const v = this.porCelda.get(k);
      if (v) v.push(e);
      else this.porCelda.set(k, [e]);
    }
    if (r.municipalityCode) {
      const v = this.porMunicipio.get(r.municipalityCode);
      if (v) v.push(e);
      else this.porMunicipio.set(r.municipalityCode, [e]);
    }
  }
}

const cuentaContactos = (r: NormalizedRecord) => ({
  telefono: r.phones.length,
  email: r.emails.length,
  web: r.websites.length,
});

/**
 * Clasifica cada registro contra la base de datos actual, sin escribir.
 *
 * @param descartadas registros que la fuente ya filtró antes de llegar aquí (sin nombre,
 *   sin categoría, cadena excluida…), con su motivo. La previsualización no los reevalúa:
 *   los traslada al informe para que el recuento cuadre con el total de la fuente.
 */
export async function previsualizar(
  db: Db,
  fuente: string,
  registros: NormalizedRecord[],
  descartadas: Descartada[] = [],
  matchConfig: MatchConfig = DEFAULT_MATCH_CONFIG,
): Promise<InformePrevio> {
  const informe: InformePrevio = {
    fuente,
    total: registros.length + descartadas.length,
    nuevas: [],
    existentes: [],
    duplicados: [],
    descartadas,
    contactos: {
      conAlgunCanal: 0,
      telefono: 0,
      email: 0,
      web: 0,
      sinNingunCanal: 0,
    },
  };

  // Choques dentro del propio lote: dos registros de esta misma importación que se
  // emparejarían entre sí. En la importación real, el primero ya existe como entidad cuando
  // llega el segundo, así que findCandidates() lo encuentra y scoreMatch() lo puntúa; como
  // ambos vienen de la misma fuente, acaban en revisión en vez de fusionarse.
  //
  // Aquí esas entidades aún no existen, así que hay que simular ese encuentro. Se usa el
  // MISMO scoreMatch y la misma preselección que findCandidates(): candidatos a menos de
  // 1 km, o del mismo municipio con nombre parecido. Una comparación de todos contra todos
  // no escalaría a una importación grande.
  const lote = new Lote();

  // Una sola conexión para todo el informe: las consultas de emparejamiento son las mismas
  // que usa la ingesta y esperan un cliente, no el pool.
  const tx = await db.connect();
  try {
    for (const r of registros) {
      const contactos = cuentaContactos(r);
      informe.contactos.telefono += contactos.telefono > 0 ? 1 : 0;
      informe.contactos.email += contactos.email > 0 ? 1 : 0;
      informe.contactos.web += contactos.web > 0 ? 1 : 0;
      const tieneCanal =
        contactos.telefono + contactos.email + contactos.web > 0;
      informe.contactos[tieneCanal ? "conAlgunCanal" : "sinNingunCanal"] += 1;

      const base = { externalId: r.externalId, nombre: r.name, contactos };

      // ¿Ya está vinculado este mismo registro de origen? Entonces es una actualización.
      const yaVinculado = await tx.query<{ entity_id: string; name: string }>(
        `select es.entity_id, e.name
         from public.source_records sr
         join public.entity_sources es on es.source_record_id = sr.id
         join public.entities e on e.id = es.entity_id
        where sr.source_id = $1 and sr.external_id = $2`,
        [r.sourceId, r.externalId],
      );
      if (yaVinculado.rowCount) {
        informe.existentes.push({
          ...base,
          clase: "existente",
          motivo:
            "Ya importado antes desde esta misma fuente: se actualizarían sus datos",
          entidad: {
            id: yaVinculado.rows[0]!.entity_id,
            nombre: yaVinculado.rows[0]!.name,
            puntuacion: 1,
          },
        });
        continue;
      }

      const yo = toCandidate(r);
      const puntuados = (await findCandidates(tx, r))
        .map((row) => {
          const res = scoreMatch(
            yo,
            {
              normalizedName: row.normalized_name,
              entityType: row.entity_type,
              location:
                row.lon != null && row.lat != null ? [row.lon, row.lat] : null,
              locationPrecise: ["exact", "address"].includes(
                row.location_precision,
              ),
              municipalityCode: row.municipality_code,
              phones: row.phones,
              domains: row.domains,
              nifs: row.nifs,
            },
            matchConfig,
          );
          // Misma regla que la ingesta: dos registros de la misma fuente nunca se unen solos.
          if (res.decision === "same" && row.has_same_source) {
            return { row, res: { ...res, decision: "review" as const } };
          }
          return { row, res };
        })
        .filter((x) => x.res.decision !== "different")
        .sort((a, b) => b.res.score - a.res.score);

      const mejor = puntuados[0];
      const choqueLote = lote.choque(r, yo, matchConfig);

      if (mejor && mejor.res.decision === "same") {
        informe.existentes.push({
          ...base,
          clase: "existente",
          motivo:
            "Coincide con una entidad ya en la base: se vincularía a ella en lugar de crear otra",
          entidad: {
            id: mejor.row.id,
            nombre: mejor.row.normalized_name,
            puntuacion: mejor.res.score,
          },
        });
      } else if (mejor) {
        informe.duplicados.push({
          ...base,
          clase: "duplicado",
          motivo:
            "Se parece a una entidad existente pero no lo bastante: se crearía y quedaría marcado para revisión",
          entidad: {
            id: mejor.row.id,
            nombre: mejor.row.normalized_name,
            puntuacion: mejor.res.score,
          },
        });
      } else if (choqueLote) {
        informe.duplicados.push({
          ...base,
          clase: "duplicado",
          motivo:
          `Se empareja con ${choqueLote.externalId} («${choqueLote.nombre}») dentro de esta misma importación ` +
          `(${choqueLote.decision}, ${choqueLote.puntuacion}): ambos se crearían y quedarían para revisión`,
        });
      } else {
        informe.nuevas.push({
          ...base,
          clase: "nueva",
          motivo: "No existe nada parecido: se crearía",
        });
      }
      lote.añadir(r, yo);
    }
  } finally {
    tx.release();
  }

  return informe;
}

/** Resumen legible para la terminal. */
export function resumen(i: InformePrevio): string {
  const pct = (n: number) =>
    i.total ? ` (${Math.round((100 * n) / i.total)} %)` : "";
  return [
    `Previsualización de «${i.fuente}» · ${i.total} registros en origen`,
    `  Nuevas entidades    ${String(i.nuevas.length).padStart(5)}${pct(i.nuevas.length)}`,
    `  Entidades existentes${String(i.existentes.length).padStart(5)}${pct(i.existentes.length)}`,
    `  Duplicados a revisar${String(i.duplicados.length).padStart(5)}${pct(i.duplicados.length)}`,
    `  Descartados         ${String(i.descartadas.length).padStart(5)}${pct(i.descartadas.length)}`,
    "",
    `  Con algún canal de contacto ${i.contactos.conAlgunCanal} · sin ninguno ${i.contactos.sinNingunCanal}`,
    `  teléfono ${i.contactos.telefono} · email ${i.contactos.email} · web ${i.contactos.web}`,
  ].join("\n");
}
