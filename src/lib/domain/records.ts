// Formato común al que cada importador traduce los registros de su fuente.

export type EntityType = "comercio" | "distribuidor" | "club" | "asociacion" | "comunidad";
export type LocationPrecision = "exact" | "address" | "street" | "postal_code" | "municipality" | "unknown";
export type ValueMethod = "found" | "verified" | "inferred" | "manual";

export interface RecordLocation {
  lon: number;
  lat: number;
  precision: LocationPrecision;
  /** Fuente que produjo la coordenada (la propia fuente o el geocodificador). */
  sourceId: string;
  method: ValueMethod;
  confidence: number;
}

/**
 * Campo adicional con procedencia propia, para fuentes de investigación curada donde
 * cada dato se ha verificado con un método y en una fecha distintos (p. ej. la web de la
 * empresa confirma la especialización, pero el teléfono viene de un directorio).
 */
export interface ExtraField {
  field: string;
  value: unknown;
  method: ValueMethod;
  confidence: number;
  /** Página concreta de la que sale este dato, si no es la del registro. */
  sourceUrl?: string | null;
  /** Cuándo se observó (ISO). Si falta, se usa el momento de la carga. */
  observedAt?: string | null;
}

export interface NormalizedRecord {
  sourceId: string;
  externalId: string;
  /** Registro original completo, tal y como lo publicó la fuente. */
  payload: Record<string, unknown>;
  sourceUrl: string | null;
  entityType: EntityType;
  name: string;
  normalizedName: string;
  categories: { categoryId: string; priority: number }[];
  address: { text: string; isPersonal: boolean } | null;
  postalCode: string | null;
  municipalityCode: string | null;
  location: RecordLocation | null;
  phones: { raw: string; e164: string; isPersonal: boolean }[];
  websites: { raw: string; normalized: string }[];
  emails: { raw: string; normalized: string; isPersonal: boolean }[];
  identifiers: { scheme: "nif" | "red_galicia" | "osm" | "wikidata" | "registro"; value: string }[];
  openingHours: string | null;
  /** Campos propios de la fuente, cada uno con su método y su fecha de verificación. */
  extraFields?: ExtraField[];
}
