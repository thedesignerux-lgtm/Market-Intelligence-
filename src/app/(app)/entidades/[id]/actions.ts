"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSession, canEditCrm } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: boolean; error: string | null };

const uuid = z.string().uuid();

export async function setCrmStatus(entityId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const session = await getSession();
  if (!canEditCrm(session.role)) return { ok: false, error: "Tu rol no permite cambiar el estado comercial." };
  const parsed = z
    .object({ entityId: uuid, statusId: uuid, priority: z.enum(["", "1", "2", "3"]) })
    .safeParse({ entityId, statusId: formData.get("status_id"), priority: formData.get("priority") ?? "" });
  if (!parsed.success) return { ok: false, error: "Elige un estado válido." };

  const supabase = await createClient();
  const { error } = await supabase.from("entity_crm").upsert(
    {
      workspace_id: session.workspaceId!,
      entity_id: parsed.data.entityId,
      status_id: parsed.data.statusId,
      priority: parsed.data.priority ? Number(parsed.data.priority) : null,
    },
    { onConflict: "workspace_id,entity_id" },
  );
  if (error) return { ok: false, error: "No se pudo guardar el estado. Inténtalo de nuevo." };
  revalidatePath(`/entidades/${entityId}`);
  return { ok: true, error: null };
}

export async function addNote(entityId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const session = await getSession();
  if (!canEditCrm(session.role)) return { ok: false, error: "Tu rol no permite añadir notas." };
  const parsed = z
    .object({ entityId: uuid, body: z.string().trim().min(1, "Escribe la nota.").max(10000, "La nota es demasiado larga.") })
    .safeParse({ entityId, body: formData.get("body") });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Nota no válida." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("entity_notes")
    .insert({ workspace_id: session.workspaceId!, entity_id: parsed.data.entityId, body: parsed.data.body });
  if (error) return { ok: false, error: "No se pudo guardar la nota. Inténtalo de nuevo." };
  revalidatePath(`/entidades/${entityId}`);
  return { ok: true, error: null };
}

export async function deleteNote(entityId: string, noteId: string): Promise<void> {
  await getSession();
  if (!uuid.safeParse(noteId).success || !uuid.safeParse(entityId).success) return;
  const supabase = await createClient();
  // RLS limita el borrado al autor o a un administrador.
  await supabase.from("entity_notes").delete().eq("id", noteId);
  revalidatePath(`/entidades/${entityId}`);
}
