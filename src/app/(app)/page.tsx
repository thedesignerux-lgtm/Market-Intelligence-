import Link from "next/link";
import { EmptyState, PageHeader, SourceMarks } from "@/components/ui";
import { RUN_STATUS, SOURCE, formatDate } from "@/lib/labels";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Resumen" };

interface MunicipalityRow {
  municipality_code: string;
  municipality_name: string;
  entities: number;
  comercios: number;
  clubes: number;
  otras: number;
  con_ubicacion: number;
  sin_verificar: number;
  sources: string[];
  last_seen_at: string;
}

const PROVINCES = [
  { code: "15", name: "A Coruña" },
  { code: "27", name: "Lugo" },
  { code: "32", name: "Ourense" },
  { code: "36", name: "Pontevedra" },
];
const TOP_MUNICIPALITIES = 15;

function MunicipalityRows({ rows }: { rows: MunicipalityRow[] }) {
  return (
    <>
      {rows.map((m) => (
        <tr key={m.municipality_code} className="border-b border-line last:border-0">
          <td className="px-4 py-3">
            <Link className="font-medium hover:underline" href={`/directorio?municipio=${m.municipality_code}`}>
              {m.municipality_name}
            </Link>
          </td>
          <td className="px-4 py-3 text-right">{m.comercios}</td>
          <td className="px-4 py-3 text-right">{m.clubes}</td>
          <td className="px-4 py-3 text-right">
            {m.con_ubicacion} <span className="text-ink-faint">de {m.entities}</span>
          </td>
          <td className="px-4 py-3">
            <SourceMarks sources={m.sources} />
          </td>
          <td className="px-4 py-3 text-ink-soft">{formatDate(m.last_seen_at)}</td>
        </tr>
      ))}
    </>
  );
}

export default async function SummaryPage() {
  await getSession();
  const supabase = await createClient();
  const [{ data: munis, error }, { data: runs }, { count: pending }] = await Promise.all([
    supabase.from("municipality_summary").select("*").order("entities", { ascending: false }).returns<MunicipalityRow[]>(),
    supabase.from("import_runs").select("id, source_id, status, created_at, finished_at, scope").order("created_at", { ascending: false }).limit(5),
    supabase.from("duplicate_candidates").select("id", { count: "exact", head: true }).eq("status", "pending"),
  ]);

  const total = (munis ?? []).reduce((s, m) => s + m.entities, 0);
  const located = (munis ?? []).reduce((s, m) => s + m.con_ubicacion, 0);
  const provinces = PROVINCES.map((p) => {
    const rows = (munis ?? []).filter((m) => m.municipality_code.startsWith(p.code));
    return {
      ...p,
      municipios: rows.length,
      comercios: rows.reduce((s, m) => s + m.comercios, 0),
      clubes: rows.reduce((s, m) => s + m.clubes, 0),
      entities: rows.reduce((s, m) => s + m.entities, 0),
      con_ubicacion: rows.reduce((s, m) => s + m.con_ubicacion, 0),
    };
  }).filter((p) => p.entities > 0);
  const topMunis = (munis ?? []).slice(0, TOP_MUNICIPALITIES);
  const restMunis = (munis ?? []).slice(TOP_MUNICIPALITIES);

  return (
    <main className="mx-auto max-w-[1100px] px-4 py-6 md:px-8">
      <PageHeader
        title="Resumen"
        description="Lo que hay en la base de datos y de dónde procede. La cobertura depende de cada fuente: que un municipio aparezca no significa que estén todos sus negocios."
        actions={
          <Link href="/directorio" className="btn-primary">
            Abrir directorio
          </Link>
        }
      />

      {error && <p className="mt-6 text-danger">No se pudo cargar el resumen: {error.message}</p>}

      {total === 0 ? (
        <div className="mt-6">
          <EmptyState title="Todavía no hay entidades">
            Lanza una importación de un municipio desde <Link className="text-atlantic underline" href="/importaciones">Importaciones</Link>.
            Las entidades aparecerán aquí cuando el importador termine.
          </EmptyState>
        </div>
      ) : (
        <>
          <p className="mt-6 text-[15px]">
            <strong className="font-semibold">{total}</strong> entidades en {munis?.length} {munis?.length === 1 ? "municipio" : "municipios"};{" "}
            <strong className="font-semibold">{located}</strong> con ubicación en el mapa.
            {(pending ?? 0) > 0 && (
              <>
                {" "}
                <Link href="/duplicados" className="text-atlantic underline underline-offset-2">
                  {pending} {pending === 1 ? "posible duplicado" : "posibles duplicados"} por revisar
                </Link>
                .
              </>
            )}
          </p>

          {provinces.length > 1 && (
            <section className="mt-6" aria-labelledby="provincias">
              <h2 id="provincias" className="text-[16px] font-semibold">
                Por provincia
              </h2>
              <div className="panel mt-3 overflow-x-auto">
                <table className="w-full min-w-[560px] text-left">
                  <thead className="border-b border-line text-[13px] text-ink-soft">
                    <tr>
                      <th className="px-4 py-2.5 font-medium">Provincia</th>
                      <th className="px-4 py-2.5 text-right font-medium">Municipios con datos</th>
                      <th className="px-4 py-2.5 text-right font-medium">Comercios</th>
                      <th className="px-4 py-2.5 text-right font-medium">Clubes</th>
                      <th className="px-4 py-2.5 text-right font-medium">Con ubicación</th>
                    </tr>
                  </thead>
                  <tbody>
                    {provinces.map((p) => (
                      <tr key={p.code} className="border-b border-line last:border-0">
                        <td className="px-4 py-3 font-medium">{p.name}</td>
                        <td className="px-4 py-3 text-right">{p.municipios}</td>
                        <td className="px-4 py-3 text-right">{p.comercios}</td>
                        <td className="px-4 py-3 text-right">{p.clubes}</td>
                        <td className="px-4 py-3 text-right">
                          {p.con_ubicacion} <span className="text-ink-faint">de {p.entities}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="mt-6" aria-labelledby="cobertura">
            <h2 id="cobertura" className="text-[16px] font-semibold">
              Cobertura por municipio
            </h2>
            {restMunis.length > 0 && (
              <p className="mt-1 text-[13px] text-ink-soft">
                Los {TOP_MUNICIPALITIES} municipios con más entidades. Los demás están en la lista desplegable de abajo.
              </p>
            )}
            <div className="panel mt-3 overflow-x-auto">
              <table className="w-full min-w-[640px] text-left">
                <thead className="border-b border-line text-[13px] text-ink-soft">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Municipio</th>
                    <th className="px-4 py-2.5 text-right font-medium">Comercios</th>
                    <th className="px-4 py-2.5 text-right font-medium">Clubes</th>
                    <th className="px-4 py-2.5 text-right font-medium">Con ubicación</th>
                    <th className="px-4 py-2.5 font-medium">Fuentes</th>
                    <th className="px-4 py-2.5 font-medium">Última actualización</th>
                  </tr>
                </thead>
                <tbody>
                  <MunicipalityRows rows={topMunis} />
                </tbody>
              </table>
            </div>
            {restMunis.length > 0 && (
              <details className="panel mt-3 overflow-x-auto">
                <summary className="cursor-pointer px-4 py-3 text-[14px] font-medium">
                  Ver los otros {restMunis.length} municipios
                </summary>
                <table className="w-full min-w-[640px] border-t border-line text-left">
                  <tbody>
                    <MunicipalityRows rows={restMunis} />
                  </tbody>
                </table>
              </details>
            )}
          </section>
        </>
      )}

      <section className="mt-8" aria-labelledby="importaciones">
        <div className="flex items-baseline justify-between">
          <h2 id="importaciones" className="text-[16px] font-semibold">
            Últimas importaciones
          </h2>
          <Link href="/importaciones" className="text-[13px] text-atlantic hover:underline">
            Ver todas
          </Link>
        </div>
        {runs?.length ? (
          <ul className="panel mt-3 divide-y divide-line">
            {runs.map((r) => {
              const scope = r.scope as { municipalities?: string[] };
              return (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <span>
                    {SOURCE[r.source_id]?.name ?? r.source_id}
                    <span className="text-ink-soft"> en {scope.municipalities?.length ?? 0} municipio(s)</span>
                  </span>
                  <span className="text-ink-soft">
                    {RUN_STATUS[r.status]}, {formatDate(r.finished_at ?? r.created_at, true)}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-3 text-ink-soft">Aún no se ha lanzado ninguna importación.</p>
        )}
      </section>
    </main>
  );
}
