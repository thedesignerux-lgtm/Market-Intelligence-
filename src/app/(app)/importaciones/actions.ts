"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canCurate, getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export type ImportState = { ok: boolean; error: string | null; started?: boolean };

/**
 * Lanza el importador en GitHub Actions para que la importación empiece en seguida.
 * Requiere GITHUB_DISPATCH_TOKEN (token con permiso Actions: escritura sobre el repositorio).
 * Sin él, la importación queda en cola y se procesa en la ejecución nocturna.
 */
async function startImporter(): Promise<boolean> {
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  if (!token) return false;
  const repo = process.env.GITHUB_REPOSITORY_SLUG ?? "thedesignerux-lgtm/Market-Intelligence-";
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/importador.yml/dispatches`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "market-intelligence-web",
      },
      body: JSON.stringify({ ref: "main" }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) console.error(`[importaciones] GitHub respondió ${res.status} al lanzar el importador`);
    return res.ok;
  } catch (err) {
    console.error("[importaciones] no se pudo lanzar el importador:", (err as Error).message);
    return false;
  }
}

const GALICIA = ["15", "27", "32", "36"];

const schema = z.object({
  source: z.enum(["osm", "red_galicia"]),
  scope: z.enum(["municipio", "15", "27", "32", "36", "galicia"]),
  municipality: z.string().trim().optional(),
});

export async function requestImport(_prev: ImportState, formData: FormData): Promise<ImportState> {
  const session = await getSession();
  if (!canCurate(session.role)) return { ok: false, error: "Solo administradores y editores pueden lanzar importaciones." };
  const parsed = schema.safeParse({
    source: formData.get("source"),
    scope: formData.get("scope") ?? "municipio",
    municipality: formData.get("municipality") ?? undefined,
  });
  if (!parsed.success) return { ok: false, error: "Datos no válidos." };
  const { source, scope, municipality } = parsed.data;
  const supabase = await createClient();

  let codes: string[];
  if (scope === "municipio") {
    if (!municipality || !/^\d{5}$/.test(municipality)) {
      return { ok: false, error: "El código INE del municipio tiene 5 cifras (Santiago: 15078)." };
    }
    if (!GALICIA.includes(municipality.slice(0, 2))) {
      return { ok: false, error: "Por ahora solo se pueden importar municipios de Galicia (códigos 15, 27, 32 y 36)." };
    }
    codes = [municipality];
  } else {
    const provinces = scope === "galicia" ? GALICIA : [scope];
    const { data, error } = await supabase
      .from("admin_areas")
      .select("code")
      .eq("level", "municipio")
      .in("parent_code", provinces);
    if (error) return { ok: false, error: "No se pudo leer la lista de municipios." };
    codes = (data ?? []).map((r) => r.code as string).sort();
    if (codes.length === 0) {
      return { ok: false, error: "Todavía no hay municipios registrados para esa zona. Importa primero un municipio suelto de la provincia." };
    }
  }

  const { error } = await supabase.rpc("request_import", { p_source: source, p_municipalities: codes });
  if (error) {
    return { ok: false, error: error.code === "23505" ? "Ya hay una importación igual en curso." : "No se pudo solicitar la importación." };
  }
  const started = await startImporter();
  revalidatePath("/importaciones");
  return { ok: true, error: null, started };
}

export async function controlRun(runId: string, action: "pause" | "resume" | "cancel" | "retry_failed"): Promise<void> {
  const session = await getSession();
  if (!canCurate(session.role) || !z.string().uuid().safeParse(runId).success) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc("control_import", { p_run: runId, p_action: action });
  // Reanudar o reintentar deja tareas en cola: se lanza el importador.
  if (!error && (action === "resume" || action === "retry_failed")) await startImporter();
  revalidatePath("/importaciones");
}
