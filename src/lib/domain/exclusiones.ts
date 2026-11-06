// Cadenas excluidas de la captación comercial.
//
// Decisión comercial, no de categorías: estas empresas venden bicicletas, así que las reglas
// de `category_mappings` las clasifican bien y no se tocan. Lo que no encaja es el modelo:
// son cadenas con política de precios centralizada y sin capacidad de decisión en tienda,
// de modo que no pueden cerrar una compra agrupada con un grupo de ciclistas. Incorporarlas
// aumentaría el número de registros sin aumentar la oferta comercial real.
//
// Por eso se descartan al construir el registro, después de clasificar, no antes: la regla
// general sigue valiendo para cualquier otra fuente y el motivo queda contado en las
// estadísticas de la importación como `skipped_excluded_chain`.

import { fold } from "./normalize";

/**
 * Cada patrón se compara contra el nombre plegado (sin acentos, en minúsculas).
 * Son prefijos de palabra: "decathlon" casa con «Decathlon Diagonal Mar», y
 * "sprinter" con «Sprinter Gran Vía», pero ninguno casa con «Bicicletas Sprinterman».
 */
export const CADENAS_EXCLUIDAS: { patron: string; motivo: string }[] = [
  { patron: "decathlon", motivo: "Gran superficie con precios centralizados" },
  { patron: "sprinter", motivo: "Gran superficie con precios centralizados" },
];

// El patrón tiene que ser una palabra completa por los dos lados: lo precede el inicio del
// nombre o algo que no es letra ni número, y lo sigue lo mismo (se admite el plural).
//
// El límite por la derecha es deliberado: sin él, «Bicicletas Sprinterman» —una tienda
// independiente— quedaría excluida por contener «sprinter». Un falso positivo aquí borra un
// vendedor real sin que nadie se entere, así que se prefiere pecar de incluir de más.
const limite = (nombre: string, patron: string): boolean =>
  new RegExp(`(^|[^\\p{L}\\p{N}])${patron}s?($|[^\\p{L}\\p{N}])`, "u").test(nombre);

/** ¿Este nombre corresponde a una cadena excluida? Devuelve el motivo, o null si no lo es. */
export function cadenaExcluida(nombre: string): string | null {
  const n = fold(nombre);
  for (const { patron, motivo } of CADENAS_EXCLUIDAS) {
    if (limite(n, patron)) return motivo;
  }
  return null;
}
