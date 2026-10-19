import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { ROLE_FILTER } from "@/lib/labels";
import { MapView } from "./map-view";

export const metadata = { title: "Mapa" };

export default async function MapPage({ searchParams }: { searchParams: Promise<{ id?: string; rol?: string; categoria?: string }> }) {
  const session = await getSession();
  const { id, rol, categoria } = await searchParams;
  const supabase = await createClient();
  const [{ data: statuses }, { data: categories }, focusRes] = await Promise.all([
    supabase.from("crm_statuses").select("slug, label").eq("workspace_id", session.workspaceId!).order("sort"),
    supabase.from("categories").select("id, name, parent_id").order("sort"),
    id && /^[0-9a-f-]{36}$/i.test(id)
      ? supabase.from("entity_details").select("id, name, lon, lat").eq("id", id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const f = focusRes.data as { id: string; name: string; lon: number | null; lat: number | null } | null;
  const focus = f && f.lon != null && f.lat != null ? { id: f.id, name: f.name, lon: f.lon, lat: f.lat } : null;
  return (
    <main>
      <h1 className="sr-only">Mapa</h1>
      <MapView
        workspaceId={session.workspaceId!}
        focus={focus}
        statuses={statuses ?? []}
        categories={categories ?? []}
        initial={{ role: rol && rol in ROLE_FILTER ? rol : "", category: categoria && /^[a-z.]{2,80}$/.test(categoria) ? categoria : "" }}
      />
    </main>
  );
}
