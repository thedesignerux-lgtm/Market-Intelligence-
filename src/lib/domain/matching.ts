// Puntuación de similitud entre dos registros para detectar duplicados.
// Configurable y explicable: devuelve la puntuación y las señales que la justifican.

import { distinctiveTokens } from "./normalize";

export interface MatchCandidate {
  normalizedName: string;
  entityType: string;
  /** [lon, lat] o null si no hay ubicación fiable. */
  location: [number, number] | null;
  locationPrecise: boolean;
  municipalityCode: string | null;
  phones: string[]; // E.164
  domains: string[];
  nifs: string[];
}

export interface MatchConfig {
  /** A partir de esta puntuación se vincula automáticamente. */
  autoLinkThreshold: number;
  /** Entre este valor y el anterior, se crea un posible duplicado para revisión manual. */
  reviewThreshold: number;
}

export const DEFAULT_MATCH_CONFIG: MatchConfig = {
  autoLinkThreshold: 0.85,
  reviewThreshold: 0.5,
};

export type MatchDecision = "same" | "review" | "different";

export interface MatchResult {
  score: number;
  decision: MatchDecision;
  signals: Record<string, number | string | boolean>;
}

/** Distancia en metros entre dos puntos [lon, lat] (haversine). */
export function distanceMeters(a: [number, number], b: [number, number]): number {
  const R = 6371008.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Trigramas al estilo pg_trgm (palabras con relleno de espacios). */
function trigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (const word of s.split(" ").filter(Boolean)) {
    const w = `  ${word} `;
    for (let i = 0; i + 3 <= w.length; i++) out.add(w.slice(i, i + 3));
  }
  return out;
}

export function trigramSimilarity(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

/** Similitud de nombres: máximo entre trigramas y coincidencia de tokens distintivos. */
export function nameSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const tri = trigramSimilarity(a, b);
  const ta = new Set(distinctiveTokens(a));
  const tb = new Set(distinctiveTokens(b));
  let tokenScore = 0;
  if (ta.size > 0 && tb.size > 0) {
    let inter = 0;
    for (const t of ta) if (tb.has(t)) inter++;
    // Contención: "compostelano" frente a "ciclista compostelano" cuenta como coincidencia fuerte.
    tokenScore = inter / Math.min(ta.size, tb.size);
    // Penaliza cuando solo coincide una parte pequeña del nombre más largo.
    tokenScore *= 0.6 + 0.4 * (inter / Math.max(ta.size, tb.size));
  }
  return Math.max(tri, tokenScore);
}

const intersects = (a: string[], b: string[]) => a.some((x) => b.includes(x));

export function scoreMatch(a: MatchCandidate, b: MatchCandidate, config: MatchConfig = DEFAULT_MATCH_CONFIG): MatchResult {
  const signals: MatchResult["signals"] = {};

  if (a.entityType !== b.entityType) {
    return { score: 0, decision: "different", signals: { entity_type_mismatch: true } };
  }

  // Un NIF distinto en ambos lados es prueba fuerte de que son entidades diferentes.
  if (a.nifs.length > 0 && b.nifs.length > 0) {
    if (intersects(a.nifs, b.nifs)) {
      signals.same_nif = true;
      return { score: 1, decision: "same", signals };
    }
    signals.different_nif = true;
    return { score: 0, decision: "different", signals };
  }

  const nameSim = nameSimilarity(a.normalizedName, b.normalizedName);
  signals.name_similarity = Number(nameSim.toFixed(3));
  let score = 0.55 * nameSim;

  if (intersects(a.phones, b.phones)) {
    signals.same_phone = true;
    score += 0.3;
  }
  if (intersects(a.domains, b.domains)) {
    signals.same_website = true;
    score += 0.3;
  }

  if (a.location && b.location) {
    const d = distanceMeters(a.location, b.location);
    signals.distance_m = Math.round(d);
    const precise = a.locationPrecise && b.locationPrecise;
    if (d <= 60) score += precise ? 0.3 : 0.2;
    else if (d <= 250) score += 0.15;
    else if (d <= 1000) score += 0.05;
    else if (precise && d > 3000) score -= 0.3;
  } else if (a.municipalityCode && a.municipalityCode === b.municipalityCode) {
    signals.same_municipality = true;
    score += 0.05;
  }

  // Sin ninguna señal de contacto o ubicación, un nombre parecido no basta para fusionar solo.
  const hasStrongSignal = Boolean(signals.same_phone || signals.same_website || (typeof signals.distance_m === "number" && signals.distance_m <= 250));
  score = Math.max(0, Math.min(1, score));
  let decision: MatchDecision = "different";
  if (score >= config.autoLinkThreshold && hasStrongSignal && nameSim >= 0.5) decision = "same";
  else if (score >= config.reviewThreshold) decision = "review";
  return { score: Number(score.toFixed(3)), decision, signals };
}
