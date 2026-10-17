import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";

export type Role = "admin" | "editor" | "comercial" | "lector";

export interface AppSession {
  userId: string;
  email: string | null;
  workspaceId: string | null;
  workspaceName: string | null;
  role: Role | null;
}

/** Usuario y espacio de trabajo actuales. Herramienta interna: se usa el primer espacio del usuario. */
export const getSession = cache(async (): Promise<AppSession> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) redirect("/login");

  const { data: membership } = await supabase
    .from("memberships")
    .select("workspace_id, role, workspaces(name)")
    .eq("user_id", claims.sub)
    .order("created_at")
    .limit(1)
    .maybeSingle();

  const ws = membership?.workspaces as unknown as { name: string } | null;
  return {
    userId: claims.sub,
    email: (claims.email as string | undefined) ?? null,
    workspaceId: membership?.workspace_id ?? null,
    workspaceName: ws?.name ?? null,
    role: (membership?.role as Role | undefined) ?? null,
  };
});

export const canEditCrm = (role: Role | null) => role === "admin" || role === "editor" || role === "comercial";
export const canCurate = (role: Role | null) => role === "admin" || role === "editor";
