import Link from "next/link";
import { CrmBadge, EmptyState, ErrorNote, PageHeader, PrecisionMeter, SourceMarks } from "@/components/ui";
import { ENTITY_TYPE } from "@/lib/labels";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Directorio" };

const PAGE_SIZE = 50;

interface Row {
  id: string;
  entity_type: string;
  name: string;
  category_name: string | null;
  address: string | null;
  municipality_name: string | null;
  location_precision: string;
  status: string;
  crm_status: string | null;
  crm_status_label: string | null;
  sources: string[] | null;
  score: number | null;
  sort_key: string;
}

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;

export default async function DirectoryPage({ searchParams }: { searchParams: Promise<Params> }) {
  const session = await getSession();
  const sp = await searchParams;
  const q = one(sp.q)?.slice(0, 120);
  const tipo = one(sp.tipo);
  const categoria = one(sp.categoria);
  const estado = one(sp.estado);
  const municipio = one(sp.municipio);
  const after = one(sp.after);

  // Cursor: "puntuación~clave~id" (la puntuación solo existe cuando hay texto de búsqueda).
  let cursor: { score?: number; key?: string; id?: string } = {};
  if (after) {
    const [score, key, id] = after.split("~");
    cursor = { score: score ? Number(score) : undefined, key: key ? decodeURIComponent(key) : undefined, id };
  }

  const supabase = await createClient();
  const [{ data: rowsData, error }, { data: categories }, { data: munis }, { data: statuses }] = await Promise.all([
    supabase
      .rpc("search_entities", {
        p_workspace: session.workspaceId!,
        p_q: q,
        p_types: tipo && tipo in ENTITY_TYPE ? [tipo as "comercio"] : undefined,
        p_category: categoria,
        p_municipality: municipio,
        p_crm_status: estado,
        p_limit: PAGE_SIZE + 1,
        p_after_score: cursor.score,
        p_after_key: cursor.key,
        p_after_id: cursor.id,
      }),
    supabase.from("categories").select("id, name, parent_id").order("sort"),
    supabase.from("municipality_summary").select("municipality_code, municipality_name").order("municipality_name"),
    supabase.from("crm_statuses").select("slug, label").eq("workspace_id", session.workspaceId!).order("sort"),
  ]);

  const rows = rowsData as Row[] | null;
  const page = (rows ?? []).slice(0, PAGE_SIZE);
  const hasMore = (rows?.length ?? 0) > PAGE_SIZE;
  const last = page.at(-1);
  const baseParams = new URLSearchParams(
    Object.entries({ q, tipo, categoria, estado, municipio }).filter((e): e is [string, string] => Boolean(e[1])),
  );
  const nextHref = (() => {
    if (!hasMore || !last) return null;
    const p = new URLSearchParams(baseParams);
    p.set("after", `${q ? last.score : ""}~${q ? "" : encodeURIComponent(last.sort_key)}~${last.id}`);
    return `/directorio?${p}`;
  })();
  const filtered = baseParams.toString() !== "";

  return (
    <main className="mx-auto max-w-[1200px] px-4 py-6 md:px-8">
      <PageHeader
        title="Directorio"
        description="Comercios, clubes y asociaciones importados de fuentes abiertas. Cada fila indica de qué fuente procede."
        actions={
          <Link href={`/mapa${municipio ? `?municipio=${municipio}` : ""}`} className="btn-secondary">
            Ver en el mapa
          </Link>
        }
      />

      <form className="mt-5 grid gap-3 md:grid-cols-[minmax(220px,2fr)_repeat(4,minmax(140px,1fr))_auto]" role="search" aria-label="Buscar en el directorio">
        <label className="flex flex-col gap-1">
          <span className="label">Buscar</span>
          <input name="q" defaultValue={q} placeholder="Nombre o dirección" className="field" type="search" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label">Tipo</span>
          <select name="tipo" defaultValue={tipo ?? ""} className="field">
            <option value="">Todos</option>
            {Object.entries(ENTITY_TYPE).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="label">Categoría</span>
          <select name="categoria" defaultValue={categoria ?? ""} className="field">
            <option value="">Todas</option>
            {categories?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.parent_id ? `  ${c.name}` : c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="label">Municipio</span>
          <select name="municipio" defaultValue={municipio ?? ""} className="field">
            <option value="">Todos</option>
            {munis?.map((m) => (
              <option key={m.municipality_code} value={m.municipality_code!}>
                {m.municipality_name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="label">Estado comercial</span>
          <select name="estado" defaultValue={estado ?? ""} className="field">
            <option value="">Todos</option>
            <option value="sin_estado">Sin estado</option>
            {statuses?.map((s) => (
              <option key={s.slug} value={s.slug}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end gap-2">
          <button className="btn-primary" type="submit">
            Buscar
          </button>
          {filtered && (
            <Link href="/directorio" className="btn-secondary">
              Limpiar
            </Link>
          )}
        </div>
      </form>

      <div className="mt-5">
        {error ? (
          <ErrorNote>No se pudo cargar el directorio: {error.message}</ErrorNote>
        ) : page.length === 0 ? (
          <EmptyState title={filtered ? "Ningún resultado con estos filtros" : "El directorio está vacío"}>
            {filtered ? "Prueba con menos filtros o con otra forma de escribir el nombre." : (
              <>
                Importa un municipio desde <Link className="text-atlantic underline" href="/importaciones">Importaciones</Link>.
              </>
            )}
          </EmptyState>
        ) : (
          <div className="panel overflow-x-auto">
            <table className="w-full min-w-[860px] text-left">
              <thead className="border-b border-line text-[13px] text-ink-soft">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Nombre</th>
                  <th className="px-4 py-2.5 font-medium">Tipo</th>
                  <th className="px-4 py-2.5 font-medium">Municipio</th>
                  <th className="px-4 py-2.5 font-medium">Ubicación</th>
                  <th className="px-4 py-2.5 font-medium">Fuentes</th>
                  <th className="px-4 py-2.5 font-medium">Estado comercial</th>
                </tr>
              </thead>
              <tbody>
                {page.map((r) => (
                  <tr key={r.id} className="border-b border-line last:border-0 hover:bg-paper/60">
                    <td className="max-w-[380px] px-4 py-3">
                      <Link href={`/entidades/${r.id}`} className="font-medium hover:underline">
                        {r.name}
                      </Link>
                      <div className="truncate text-[13px] text-ink-soft">
                        {[r.category_name, r.status === "unverified" ? "ya no aparece en su fuente" : null].filter(Boolean).join(", ")}
                      </div>
                    </td>
                    <td className="px-4 py-3">{ENTITY_TYPE[r.entity_type]}</td>
                    <td className="px-4 py-3">{r.municipality_name ?? "—"}</td>
                    <td className="px-4 py-3">
                      <PrecisionMeter precision={r.location_precision} />
                    </td>
                    <td className="px-4 py-3">
                      <SourceMarks sources={r.sources} />
                    </td>
                    <td className="px-4 py-3">
                      <CrmBadge slug={r.crm_status} label={r.crm_status_label} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
