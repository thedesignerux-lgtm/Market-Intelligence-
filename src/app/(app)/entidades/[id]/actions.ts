"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSession, canEditCrm } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: boolean; error: string | null };

const uuid = z.string().uuid();

export async function setCrmStatus(entityId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const session = await getSession();
  if (!canEditCrm(session.role)) return { ok: false, error: "Tu rol no permite cambiar el seguimiento comercial." };
  const parsed = z
    .object({
      entityId: uuid,
      statusId: uuid,
      priority: z.enum(["", "1", "2", "3"]),
      nextAction: z.string().trim().max(200, "La próxima acción es demasiado larga (máximo 200 caracteres)."),
      nextActionAt: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha no válida.")]),
    })
    .safeParse({
      entityId,
      statusId: formData.get("status_id"),
      priority: formData.get("priority") ?? "",
      nextAction: formData.get("next_action") ?? "",
      nextActionAt: formData.get("next_action_at") ?? "",
    });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue?.path[0] === "statusId" ? "Elige un estado." : (issue?.message ?? "Datos no válidos.") };
  }
  const { nextAction, nextActionAt } = parsed.data;
  if (Boolean(nextAction) !== Boolean(nextActionAt)) {
    return { ok: false, error: "Indica la próxima acción y su fecha, o deja los dos campos vacíos." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("entity_crm").upsert(
    {
      workspace_id: session.workspaceId!,
      entity_id: parsed.data.entityId,
      status_id: parsed.data.statusId,
      priority: parsed.data.priority ? Number(parsed.data.priority) : null,
      next_action: nextAction || null,
      next_action_at: nextActionAt || null,
    },
    { onConflict: "workspace_id,entity_id" },
  );
  if (error) return { ok: false, error: "No se pudo guardar. Inténtalo de nuevo." };
  revalidatePath(`/entidades/${entityId}`);
  revalidatePath("/seguimiento");
  revalidatePath("/");
  return { ok: true, error: null };
}

export async function setRoles(entityId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const session = await getSession();
  if (!canEditCrm(session.role)) return { ok: false, error: "Tu rol no permite cambiar la clasificación." };
  if (!uuid.safeParse(entityId).success) return { ok: false, error: "Entidad no válida." };
  const on = (k: string) => formData.get(k) === "on";
  const text = (k: string) => {
    const v = formData.get(k);
    return typeof v === "string" ? v.trim().slice(0, 500) : "";
  };
  // Los campos de participación solo los envía el formulario a administradores y editores;
  // para el resto se reenvían los valores actuales y la base de datos rechaza cualquier cambio.
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_entity_roles", {
    p_workspace: session.workspaceId!,
    p_entity: entityId,
    p_buyer_potential: on("buyer_potential"),
    p_seller_potential: on("seller_potential"),
    p_buyer_participant: on("buyer_participant"),
    p_buyer_evidence: text("buyer_evidence"),
    p_seller_participant: on("seller_participant"),
    p_seller_evidence: text("seller_evidence"),
  });
  if (error) {
    if (error.code === "23514") return { ok: false, error: error.message };
    if (error.code === "42501") return { ok: false, error: "Solo administradores y editores pueden marcar la participación en GROPO." };
    return { ok: false, error: "No se pudo guardar la clasificación. Inténtalo de nuevo." };
  }
  revalidatePath(`/entidades/${entityId}`);
  revalidatePath("/");
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
