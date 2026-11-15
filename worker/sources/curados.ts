// Fuente de datos comerciales curados: investigación hecha a mano y revisada en un diff,
// no un volcado periódico de datos abiertos.
//
// Por eso no pasa por la cola de importación por municipios (`request_import` exige códigos
// INE y fuentes de tipo osm/open_data): un distribuidor nacional no tiene municipio. Lo que sí
// comparte con el resto es el destino: traduce a NormalizedRecord y lo ingresa `ingestRecord`,
// de modo que la deduplicación, la vinculación y la procedencia son exactamente las mismas.

import { readFile } from "node:fs/promises";
import { cadenaExcluida } from "../../src/lib/domain/exclusiones";
import { displayName, normalizeName, normalizePhone, normalizeWebsite } from "../../src/lib/domain/normalize";
import type { ExtraField, NormalizedRecord, ValueMethod } from "../../src/lib/domain/records";

export const CURADOS_SOURCE_ID = "investigacion_distribuidores";

/** Un dato con su procedencia, tal y como lo guarda el fichero de investigación. */
interface CampoCurado {
  valor: string;
  fuente: string;
  metodo: ValueMethod | "inferred" | "found" | "verified";
  observado: string;
}

interface EmpresaCurada {
  clave: string;
  nombre: string;
  campos: Record<string, CampoCurado>;
  fuentes: string[];
}

export interface FicheroCurado {
  fuente_id: string;
  generado: string;
  empresas: EmpresaCurada[];
}

/** Subtipo comercial → categoría. Un mayorista y una marca no negocian igual. */
const CATEGORIA: Record<string, string> = {
  mayorista: "distribuidor.ciclismo.mayorista",
  fabricante: "distribuidor.ciclismo.fabricante",
  marca: "distribuidor.ciclismo.marca",
  central_de_compras: "distribuidor.ciclismo.central_compras",
  distribuidor: "distribuidor.ciclismo",
};

/**
 * Confianza por método de verificación. Es la diferencia entre «lo dice la empresa»
 * y «lo deduce un directorio», y se guarda por campo para que luego se pueda filtrar.
 */
const CONFIANZA: Record<string, number> = { verified: 0.95, found: 0.8, inferred: 0.6, manual: 0.95 };

/** Campos del fichero que se guardan como field_values propios de distribuidor. */
const CAMPOS_PROPIOS = ["especializacion", "cobertura", "portal_b2b", "afiliacion", "catalogo"] as const;

const metodo = (c: CampoCurado): ValueMethod =>
  c.metodo === "verified" ? "verified" : c.metodo === "manual" ? "manual" : c.metodo === "inferred" ? "inferred" : "found";

/**
 * ¿Se puede clasificar esta empresa con un dato que tenga fuente?
 *
 * Sin `tipo` declarado caería en `distribuidor.ciclismo` genérico («Distribuidor de
 * bicicletas»), y eso etiquetaría a Shimano, Trek o Specialized como distribuidores cuando
 * son marcas. Un mayorista y una marca no se abordan igual, así que la etiqueta equivocada
 * no es un detalle de ficha: cambia el primer contacto.
 *
 * Por eso, por defecto, una empresa sin tipo NO entra. Entra con `--generico`, que es una
 * decisión explícita de quien ejecuta, no un silencio del código.
 */
export function tipoDeclarado(e: EmpresaCurada): string | null {
  return e.campos.tipo?.valor ?? null;
}

export function empresaARegistro(e: EmpresaCurada, fuenteId = CURADOS_SOURCE_ID): NormalizedRecord | null {
  const nombre = displayName(e.nombre);
  if (!nombre) return null;

  const web = e.campos.web;
  const sitio = web ? normalizeWebsite(web.valor) : null;
  const tel = e.campos.telefono ? normalizePhone(e.campos.telefono.valor) : null;
  const correo = e.campos.email?.valor?.trim().toLowerCase() || null;

  const tipo = e.campos.tipo?.valor ?? "distribuidor";
  const categoria = CATEGORIA[tipo] ?? CATEGORIA.distribuidor!;

  const extraFields: ExtraField[] = [];
  for (const campo of CAMPOS_PROPIOS) {
    const c = e.campos[campo];
    if (!c) continue; // Un campo que no se verificó no se inventa: simplemente no existe.
    extraFields.push({
      field: campo,
      value: c.valor,
      method: metodo(c),
      confidence: CONFIANZA[c.metodo] ?? 0.7,
      sourceUrl: c.fuente,
      observedAt: c.observado,
    });
  }

  return {
    sourceId: fuenteId,
    // La clave es el dominio: dos fuentes que citan la misma web son la misma empresa.
    externalId: e.clave,
    payload: e as unknown as Record<string, unknown>,
    sourceUrl: e.fuentes[0] ?? null,
    entityType: "distribuidor",
    name: nombre,
    normalizedName: normalizeName(nombre),
    categories: [{ categoryId: categoria, priority: 100 }],
    // Un distribuidor nacional no tiene sede comercial relevante para el mapa.
    address: null,
    postalCode: null,
    municipalityCode: null,
    location: null,
    phones: tel ? [{ raw: e.campos.telefono!.valor, e164: tel.e164, isPersonal: false }] : [],
    websites: sitio ? [{ raw: web!.valor, normalized: sitio }] : [],
    emails: correo ? [{ raw: e.campos.email!.valor, normalized: correo, isPersonal: false }] : [],
    identifiers: [],
    openingHours: null,
    extraFields,
  };
}

export interface LecturaCurada {
  registros: NormalizedRecord[];
  descartadas: { externalId: string; nombre: string; motivo: string }[];
}

export async function leerFicheroCurado(ruta: string, opts: { generico?: boolean } = {}): Promise<LecturaCurada> {
  const fichero = JSON.parse(await readFile(ruta, "utf-8")) as FicheroCurado;
  const registros: NormalizedRecord[] = [];
  const descartadas: LecturaCurada["descartadas"] = [];

  for (const e of fichero.empresas) {
    // Misma exclusión comercial que en la ruta de OSM (ADR-0011): una cadena con precios
    // centralizados no puede cerrar una oferta agrupada, tampoco como proveedora. Se descarta
    // con motivo visible, no en silencio, y basta quitar el patrón para volver a incluirla.
    const motivoCadena = cadenaExcluida(e.nombre);
    if (motivoCadena) {
      descartadas.push({ externalId: e.clave, nombre: e.nombre, motivo: `Cadena excluida de la captación: ${motivoCadena}` });
      continue;
    }
    if (!tipoDeclarado(e) && !opts.generico) {
      descartadas.push({
        externalId: e.clave,
        nombre: e.nombre,
        motivo: "Sin tipo verificado (mayorista, fabricante, marca o central de compras): entraría como distribuidor genérico",
      });
      continue;
    }
    if (e.clave.startsWith("sin-web:")) {
      // Sin web no hay clave estable: incorporarla arriesga duplicar a la empresa más adelante.
      descartadas.push({ externalId: e.clave, nombre: e.nombre, motivo: "Sin web conocida: no hay clave estable para deduplicar" });
      continue;
    }
    const r = empresaARegistro(e, fichero.fuente_id);
    if (r) registros.push(r);
    else descartadas.push({ externalId: e.clave, nombre: e.nombre, motivo: "Nombre vacío o no utilizable" });
  }
  return { registros, descartadas };
}
