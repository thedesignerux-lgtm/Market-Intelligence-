// Registros autonómicos de entidades deportivas disponibles como fuente de clubes.
import type { RegistrySource } from "./common";
import { canarias } from "./canarias";
import { cataluna } from "./cataluna";
import { euskadi } from "./euskadi";
import { navarra } from "./navarra";

export const REGISTRIES: Record<string, RegistrySource> = Object.fromEntries(
  [cataluna, euskadi, navarra, canarias].map((s) => [s.id, s]),
);
