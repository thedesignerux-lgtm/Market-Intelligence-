import Link from "next/link";
import { EntityFilterForm } from "@/components/entity-filters";
import { EntityTable } from "@/components/entity-table";
import { EmptyState, ErrorNote, PageHeader } from "@/components/ui";
import { filtersToParams, readFilters, searchEntities } from "@/lib/entities";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Directorio" };

const PAGE_SIZE = 50;

type Params = Record<string, string | string[] | undefined>;

export default async function DirectoryPage({ searchParams }: { searchParams: Promise<Params> }) {
  const session = await getSession();
  const sp = await searchParams;
  const f = readFilters(sp);
  const after = typeof sp.after === "string" ? sp.after : undefined;

  // Cursor: "puntuación~clave~id" (la puntuación solo existe cuando hay texto de búsqueda).
  let cursor: { score?: number; key?: string; id?: string } | undefined;
  if (after) {
    const [score, key, id] = after.split("~");
    cursor = { score: score ? Number(score) : undefined, key: key ? decodeURIComponent(key) : undefined, id: id && /^[0-9a-f-]{36}$/i.test(id) ? id : undefined };
  }

  const supabase = await createClient();
  const [{ rows, error }, { data: categories }, { data: munis }, { data: statuses }] = await Promise.all([
    searchEntities(supabase, session, f, { limit: PAGE_SIZE + 1, cursor }),
    supabase.from("categories").select("id, name, parent_id").order("sort"),
    supabase.from("municipality_summary").select("municipality_code, municipality_name").order("municipality_name"),
    supabase.from("crm_statuses").select("slug, label").eq("workspace_id", session.workspaceId!).order("sort"),
  ]);

  const page = rows.slice(0, PAGE_SIZE);
  const hasMore = rows.length > PAGE_SIZE;
  const last = page.at(-1);
  const baseParams = filtersToParams(f);
  const nextHref = (() => {
    if (!hasMore || !last) return null;
    const p = new URLSearchParams(baseParams);
    p.set("after", `${f.q ? last.score : ""}~${f.q ? "" : encodeURIComponent(last.sort_key)}~${last.id}`);
    return `/directorio?${p}`;
  })();
  const filtered = baseParams.toString() !== "";
  const mapParams = new URLSearchParams(Object.entries({ rol: f.rol, categoria: f.categoria }).filter((e): e is [string, string] => Boolean(e[1])));

  return (
    <main className="mx-auto max-w-[1280px] px-4 py-6 md:px-8">
      <PageHeader
        title="Directorio"
        description="Clubes, asociaciones y comercios de fuentes abiertas, con su rol comercial y su seguimiento. La ficha muestra de qué fuente procede cada dato."
        actions={
          <Link href={`/mapa${mapParams.size ? `?${mapParams}` : ""}`} className="btn-secondary">
            Ver en el mapa
          </Link>
        }
      />

      <div className="mt-5">
        <EntityFilterForm
          action="/directorio"
          filters={f}
          categories={categories ?? []}
          municipalities={(munis ?? []).map((m) => ({ code: m.municipality_code as string, name: m.municipality_name as string }))}
          statuses={statuses ?? []}
        />
      </div>

      <div className="mt-5">
        {error ? (
          <ErrorNote>No se pudo cargar el directorio. Recarga la página; si el problema sigue, avisa al administrador.</ErrorNote>
        ) : page.length === 0 ? (
          <EmptyState title={filtered ? "Ningún resultado con estos filtros" : "El directorio está vacío"}>
            {filtered ? (
              "Prueba con menos filtros o con otra forma de escribir el nombre."
            ) : (
              <>
                Importa datos desde <Link className="text-atlantic underline" href="/importaciones">Importaciones</Link>.
              </>
            )}
          </EmptyState>
        ) : (
          <div className="panel">
            <EntityTable rows={page} />
          </div>
        )}
        <nav className="mt-4 flex items-center justify-between text-[13px] text-ink-soft" aria-label="Paginación">
          <span>
            {page.length} {page.length === 1 ? "resultado" : "resultados"} en esta página
          </span>
          <span className="flex gap-2">
            {after && (
              <Link href={`/directorio?${baseParams}`} className="btn-secondary">
                Primera página
              </Link>
            )}
            {nextHref && (
              <Link href={nextHref} className="btn-secondary">
                Página siguiente
              </Link>
            )}
          </span>
        </nav>
      </div>
    </main>
  );
}
