import Link from "next/link";
import { EmptyState, PageHeader, PrecisionMeter, SourceMarks } from "@/components/ui";
import { ENTITY_TYPE, formatDate } from "@/lib/labels";
import { canCurate, getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { markDifferent, mergePair, revertMerge } from "./actions";

export const metadata = { title: "Duplicados" };

interface Side {
  id: string;
  name: string;
  entity_type: string;
  address: string | null;
  municipality_name: string | null;
  location_precision: string;
}

const SIGNAL_TEXT: Record<string, (v: unknown) => string | null> = {
  name_similarity: (v) => `Nombres parecidos al ${Math.round(Number(v) * 100)} %`,
  distance_m: (v) => `A ${v} m de distancia`,
  same_phone: () => "Mismo teléfono",
  same_website: () => "Misma web",
  same_nif: () => "Mismo NIF",
  same_municipality: () => "Mismo municipio",
  same_source: () => "Ambos vienen de la misma fuente",
};

export default async function DuplicatesPage() {
  const session = await getSession();
  const curator = canCurate(session.role);
  const supabase = await createClient();
  const [{ data: pairs }, { data: merges }] = await Promise.all([
    supabase.from("duplicate_candidates").select("id, entity_a, entity_b, score, signals, created_at").eq("status", "pending").order("score", { ascending: false }).limit(50),
    supabase.from("merge_events").select("id, survivor_id, merged_id, performed_at, reverted_at").order("performed_at", { ascending: false }).limit(10),
  ]);

  const ids = [...new Set([...(pairs ?? []).flatMap((p) => [p.entity_a, p.entity_b]), ...(merges ?? []).flatMap((m) => [m.survivor_id, m.merged_id])])];
  const [{ data: sides }, { data: srcRows }] = await Promise.all([
    ids.length
      ? supabase.from("entity_details").select("id, name, entity_type, address, municipality_name, location_precision").in("id", ids).returns<Side[]>()
      : Promise.resolve({ data: [] as Side[] }),
    ids.length
      ? supabase.from("entity_sources").select("entity_id, source_records(source_id)").in("entity_id", ids)
      : Promise.resolve({ data: [] as { entity_id: string; source_records: unknown }[] }),
  ]);
  const byId = new Map((sides ?? []).map((s) => [s.id, s]));
  const sourcesOf = (id: string) =>
    [...new Set((srcRows ?? []).filter((r) => r.entity_id === id).map((r) => (r.source_records as { source_id: string }).source_id))].sort();

  return (
    <main className="mx-auto max-w-[1100px] px-4 py-6 md:px-8">
      <PageHeader
        title="Posibles duplicados"
        description="Fichas que podrían ser la misma entidad. Nada se fusiona solo si hay dudas: decide tú. Una fusión se puede deshacer."
      />
      {!curator && <p className="mt-4 text-[13px] text-ink-soft">Solo administradores y editores pueden decidir sobre duplicados.</p>}

      <div className="mt-6 flex flex-col gap-4">
        {(pairs?.length ?? 0) === 0 ? (
          <EmptyState title="No hay duplicados pendientes">Cuando una importación encuentre fichas parecidas, aparecerán aquí.</EmptyState>
        ) : (
          pairs!.map((p) => {
            const a = byId.get(p.entity_a);
            const b = byId.get(p.entity_b);
            if (!a || !b) return null;
            const signals = Object.entries(p.signals as Record<string, unknown>)
              .map(([k, v]) => SIGNAL_TEXT[k]?.(v))
              .filter(Boolean);
            return (
              <article key={p.id} className="panel p-4" aria-label={`Posible duplicado: ${a.name} y ${b.name}`}>
                <p className="text-[13px] text-ink-soft">
                  Coincidencia {Math.round(Number(p.score) * 100)} %{signals.length ? `: ${signals.join(", ").toLowerCase()}` : ""}
                </p>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  {[a, b].map((s, i) => (
                    <div key={s.id} className="rounded-md border border-line p-3">
                      <Link href={`/entidades/${s.id}`} className="font-medium hover:underline">
                        {s.name}
                      </Link>
                      <p className="text-[13px] text-ink-soft">
                        {ENTITY_TYPE[s.entity_type]}
                        {s.municipality_name ? ` en ${s.municipality_name}` : ""}
                      </p>
                      <p className="mt-1 text-[13px]">{s.address ?? <span className="text-ink-faint">Sin dirección</span>}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-4 text-[13px]">
                        <SourceMarks sources={sourcesOf(s.id)} />
                        <PrecisionMeter precision={s.location_precision} />
                      </div>
                      {curator && (
                        <form action={mergePair.bind(null, s.id, i === 0 ? b.id : a.id)} className="mt-3">
                          <button className="btn-secondary w-full">Son la misma: conservar esta ficha</button>
                        </form>
                      )}
                    </div>
                  ))}
                </div>
                {curator && (
                  <form action={markDifferent.bind(null, p.id)} className="mt-3">
                    <button className="text-[13px] text-atlantic underline-offset-2 hover:underline">Son entidades distintas</button>
                  </form>
                )}
              </article>
            );
          })
        )}
      </div>

      {(merges?.length ?? 0) > 0 && (
        <section className="mt-10" aria-labelledby="fusiones">
          <h2 id="fusiones" className="text-[16px] font-semibold">
            Fusiones recientes
          </h2>
          <ul className="panel mt-3 divide-y divide-line">
            {merges!.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <span>
                  {byId.get(m.merged_id)?.name ?? "Ficha"} <span className="text-ink-soft">se unió a</span>{" "}
                  <Link className="hover:underline" href={`/entidades/${m.survivor_id}`}>
                    {byId.get(m.survivor_id)?.name ?? "otra ficha"}
                  </Link>
                </span>
                <span className="flex items-center gap-3 text-[13px] text-ink-soft">
                  {formatDate(m.performed_at, true)}
                  {m.reverted_at ? (
                    <span>Deshecha</span>
                  ) : (
                    curator && (
                      <form action={revertMerge.bind(null, m.id)}>
                        <button className="text-atlantic underline-offset-2 hover:underline">Deshacer</button>
                      </form>
                    )
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
