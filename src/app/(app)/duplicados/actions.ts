"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canCurate, getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export async function mergePair(survivorId: string, mergedId: string): Promise<void> {
  const session = await getSession();
  if (!canCurate(session.role)) return;
  const ids = z.tuple([z.string().uuid(), z.string().uuid()]).safeParse([survivorId, mergedId]);
  if (!ids.success) return;
  const supabase = await createClient();
  // La función comprueba permisos, mueve fuentes y datos, y deja la fusión auditada y reversible.
  await supabase.rpc("merge_entities", { p_survivor: survivorId, p_merged: mergedId });
  revalidatePath("/duplicados");
}

export async function markDifferent(candidateId: number): Promise<void> {
  const session = await getSession();
  if (!canCurate(session.role) || !Number.isInteger(candidateId)) return;
  const supabase = await createClient();
  await supabase.rpc("mark_not_duplicate", { p_candidate: candidateId });
  revalidatePath("/duplicados");
}

export async function revertMerge(eventId: string): Promise<void> {
  const session = await getSession();
  if (!canCurate(session.role) || !z.string().uuid().safeParse(eventId).success) return;
  const supabase = await createClient();
  await supabase.rpc("revert_merge", { p_event: eventId });
  revalidatePath("/duplicados");
}
