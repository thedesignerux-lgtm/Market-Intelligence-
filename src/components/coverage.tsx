import Link from "next/link";
import { PROVINCES, formatDate } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";
import { SourceMarks } from "./ui";

interface MunicipalityRow {
  municipality_code: string;
  municipality_name: string;
  entities: number;
  comercios: number;
  clubes: number;
  con_ubicacion: number;
  sources: string[];
  last_seen_at: string;
}

/** Cobertura de datos por provincia y municipio (qué se ha importado y de qué fuente). */
export async function Coverage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("municipality_summary")
    .select("municipality_code, municipality_name, entities, comercios, clubes, con_ubicacion, sources, last_seen_at")
    .order("entities", { ascending: false })
    .returns<MunicipalityRow[]>();
  if (error) return <p className="text-[13px] text-danger">No se pudo cargar la cobertura.</p>;
  const munis = data ?? [];
  if (munis.length === 0) return null;
  const provinces = PROVINCES.map((p) => {
    const rows = munis.filter((m) => m.municipality_code.startsWith(p.code));
    return {
      ...p,
      municipios: rows.length,
      comercios: rows.reduce((s, m) => s + m.comercios, 0),
      clubes: rows.reduce((s, m) => s + m.clubes, 0),
      entities: rows.reduce((s, m) => s + m.entities, 0),
      con_ubicacion: rows.reduce((s, m) => s + m.con_ubicacion, 0),
    };
  }).filter((p) => p.entities > 0);

  const Rows = ({ rows }: { rows: MunicipalityRow[] }) => (
    <>
      {rows.map((m) => (
        <tr key={m.municipality_code} className="border-b border-line last:border-0">
          <td className="px-4 py-2.5">
            <Link className="font-medium hover:underline" href={`/directorio?municipio=${m.municipality_code}`}>
              {m.municipality_name}
            </Link>
          </td>
          <td className="px-4 py-2.5 text-right">{m.comercios}</td>
          <td className="px-4 py-2.5 text-right">{m.clubes}</td>
          <td className="px-4 py-2.5 text-right">
            {m.con_ubicacion} <span className="text-ink-faint">de {m.entities}</span>
          </td>
          <td className="px-4 py-2.5">
            <SourceMarks sources={m.sources} />
          </td>
          <td className="px-4 py-2.5 text-ink-soft">{formatDate(m.last_seen_at)}</td>
        </tr>
      ))}
    </>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="panel overflow-x-auto">
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
                <td className="px-4 py-2.5">
                  <Link className="font-medium hover:underline" href={`/directorio?provincia=${p.code}`}>
                    {p.name}
                  </Link>
                </td>
                <td className="px-4 py-2.5 text-right">{p.municipios}</td>
                <td className="px-4 py-2.5 text-right">{p.comercios}</td>
                <td className="px-4 py-2.5 text-right">{p.clubes}</td>
                <td className="px-4 py-2.5 text-right">
                  {p.con_ubicacion} <span className="text-ink-faint">de {p.entities}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details className="panel overflow-x-auto">
        <summary className="cursor-pointer px-4 py-3 text-[14px] font-medium">Ver los {munis.length} municipios con datos</summary>
        <table className="w-full min-w-[640px] border-t border-line text-left">
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
            <Rows rows={munis} />
          </tbody>
        </table>
      </details>
    </div>
  );
}
