"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canCurate, getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export type ImportState = { ok: boolean; error: string | null };

const schema = z.object({
  source: z.enum(["osm", "red_galicia"]),
  municipality: z.string().trim().regex(/^\d{5}$/, "El código INE del municipio tiene 5 cifras (Santiago: 15078)."),
});

export async function requestImport(_prev: ImportState, formData: FormData): Promise<ImportState> {
  const session = await getSession();
  if (!canCurate(session.role)) return { ok: false, error: "Solo administradores y editores pueden lanzar importaciones." };
  const parsed = schema.safeParse({ source: formData.get("source"), municipality: formData.get("municipality") });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos no válidos." };
  if (!["15", "27", "32", "36"].includes(parsed.data.municipality.slice(0, 2))) {
    return { ok: false, error: "Por ahora solo se pueden importar municipios de Galicia (códigos 15, 27, 32 y 36)." };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_import", {
    p_source: parsed.data.source,
    p_municipalities: [parsed.data.municipality],
  });
  if (error) {
    return { ok: false, error: error.code === "23505" ? "Ya hay una importación igual en curso." : "No se pudo solicitar la importación." };
  }
  revalidatePath("/importaciones");
  return { ok: true, error: null };
}

export async function controlRun(runId: string, action: "pause" | "resume" | "cancel" | "retry_failed"): Promise<void> {
  const session = await getSession();
  if (!canCurate(session.role) || !z.string().uuid().safeParse(runId).success) return;
  const supabase = await createClient();
  await supabase.rpc("control_import", { p_run: runId, p_action: action });
  revalidatePath("/importaciones");
}
