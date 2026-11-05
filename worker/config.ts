// Configuración del worker desde variables de entorno (validada al arrancar).
import { z } from "zod";

/**
 * URL con valor por defecto que se puede sustituir sin desplegar (variable del repositorio
 * en GitHub Actions). Una variable sin definir llega como cadena vacía: se trata como ausente
 * para que valga el valor por defecto.
 */
const overridableUrl = (fallback: string) => z.preprocess((v) => (v === "" || v == null ? undefined : v), z.string().url().default(fallback));

const schema = z.object({
  // Conexión directa a PostgreSQL con un rol de servidor (nunca se expone al navegador).
  DATABASE_URL: z.string().min(1),
  // Contacto que se envía en el User-Agent a los servicios públicos, como piden sus políticas de uso.
  // Email o URL de contacto del proyecto (no el email personal de un usuario).
  CONTACT: z.string().min(5),
  CACHE_DIR: z.string().default(".cache"),
  OSM_EXTRACT_BASE_URL: overridableUrl("https://download.openstreetmap.fr/extracts"),
  RED_CSV_URL: overridableUrl(
    "https://abertos.xunta.gal/catalogo/cultura-ocio-deporte/-/dataset/0271/rexistro-entidades-deportivas/001/descarga-directa-ficheiro.csv",
  ),
  CARTOCIUDAD_URL: overridableUrl("https://www.cartociudad.es/geocoder/api/geocoder/find"),
  // Pausa mínima entre peticiones al geocodificador (ms).
  GEOCODER_MIN_INTERVAL_MS: z.coerce.number().int().min(100).default(250),
  // Un extracto de OSM descargado se reutiliza durante este tiempo antes de volver a pedirlo.
  OSM_EXTRACT_MAX_AGE_HOURS: z.coerce.number().min(1).default(24),
  WORKER_ID: z.string().default(`worker-${process.pid}`),
  POLL_INTERVAL_MS: z.coerce.number().int().min(500).default(5000),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Configuración no válida: ${issues}`);
  }
  return parsed.data;
}

export function userAgent(config: Config): string {
  const contact = config.CONTACT.includes("@") ? `mailto:${config.CONTACT}` : config.CONTACT;
  return `market-intelligence-importer/0.1 (+${contact})`;
}
