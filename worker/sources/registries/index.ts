// Registros autonómicos de entidades deportivas disponibles como fuente de clubes.
import type { RegistrySource } from "./common";
import { andalucia } from "./andalucia";
import { aragon } from "./aragon";
import { asturias } from "./asturias";
import { canarias } from "./canarias";
import { castillaLaMancha } from "./castilla-la-mancha";
import { castillaLeon } from "./castilla-leon";
import { cataluna } from "./cataluna";
import { euskadi } from "./euskadi";
import { madrid } from "./madrid";
import { navarra } from "./navarra";

export const REGISTRIES: Record<string, RegistrySource> = Object.fromEntries(
  [cataluna, euskadi, navarra, canarias, castillaLeon, andalucia, madrid, castillaLaMancha, aragon, asturias].map((s) => [s.id, s]),
);
