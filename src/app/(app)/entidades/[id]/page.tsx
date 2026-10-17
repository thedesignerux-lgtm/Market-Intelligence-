import Link from "next/link";
import { notFound } from "next/navigation";
import { MiniMap } from "@/components/mini-map";
import { CrmBadge, PrecisionMeter, SourceMark } from "@/components/ui";
import { ENTITY_TYPE, FIELD, METHOD, PRECISION, SOURCE, STATUS, formatDate } from "@/lib/labels";
import { canEditCrm, getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { deleteNote } from "./actions";
import { NoteForm, StatusForm } from "./crm-panel";

interface Detail {
  id: string;
  entity_type: string;
  name: string;
  category_name: string | null;
  address: string | null;
  address_is_personal: boolean;
  postal_code: string | null;
  municipality_name: string | null;
  lon: number | null;
  lat: number | null;
  location_precision: string;
  status: string;
  merged_into: string | null;
  first_seen_at: string;
  last_seen_at: string;
}

interface FieldValue {
  id: number;
  field: string;
  value: unknown;
  source_id: string;
  method: string;
  confidence: number;
  observed_at: string;
  is_selected: boolean;
  source_url: string | null;
}

/** "+34654448283" → "654 448 283" (números españoles); el resto se muestra tal cual. */
function formatPhone(e164: string): string {
  return e164.replace(/^\+34(\d{3})(\d{3})(\d{3})$/, "$1 $2 $3");
}

const FIELD_ORDER = ["name", "address", "postal_code", "municipality_code", "location", "phone", "website", "email", "opening_hours"];

function renderValue(field: string, value: unknown, municipalityName: string | null): string {
  if (value == null) return "—";
  if (field === "address") return (value as { text: string }).text;
  if (field === "location") {
    const v = value as { lon: number; lat: number; precision: string };
    return `${PRECISION[v.precision]?.label ?? v.precision}: ${v.lat.toFixed(5)}, ${v.lon.toFixed(5)}`;
  }
  if (field === "municipality_code") return municipalityName ?? String(value);
  if (field === "phone" && Array.isArray(value)) return value.map((v) => formatPhone(String(v))).join(", ");
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("entity_details").select("name").eq("id", id).maybeSingle();
  return { title: data?.name ?? "Ficha" };
}

export default async function EntityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const session = await getSession();
  const supabase = await createClient();

  const { data: e } = await supabase.from("entity_details").select("*").eq("id", id).maybeSingle<Detail>();
  if (!e) notFound();

  const [values, contacts, identifiers, records, crm, statuses, notes, events, dups] = await Promise.all([
    supabase.from("field_values").select("id, field, value, source_id, method, confidence, observed_at, is_selected, source_url").eq("entity_id", id).returns<FieldValue[]>(),
    supabase.from("contact_points").select("kind, value, normalized, is_personal_data, source_id").eq("entity_id", id),
    supabase.from("entity_identifiers").select("scheme, value").eq("entity_id", id),
    supabase.from("entity_sources").select("link_method, confidence, source_records(source_id, external_id, last_seen_at, missing_since, first_seen_at)").eq("entity_id", id),
    supabase.from("entity_crm").select("status_id, priority, updated_at, crm_statuses(slug, label, blocks_contact)").eq("entity_id", id).eq("workspace_id", session.workspaceId!).maybeSingle(),
    supabase.from("crm_statuses").select("id, slug, label, blocks_contact").eq("workspace_id", session.workspaceId!).order("sort"),
    supabase.from("entity_notes").select("id, body, created_at, author_id").eq("entity_id", id).eq("workspace_id", session.workspaceId!).order("created_at", { ascending: false }),
    supabase.from("crm_events").select("id, kind, from_value, to_value, created_at").eq("entity_id", id).eq("workspace_id", session.workspaceId!).order("created_at", { ascending: false }).limit(15),
    supabase.from("duplicate_candidates").select("id", { count: "exact", head: true }).eq("status", "pending").or(`entity_a.eq.${id},entity_b.eq.${id}`),
  ]);

  const byField = new Map<string, FieldValue[]>();
  for (const v of values.data ?? []) byField.set(v.field, [...(byField.get(v.field) ?? []), v]);
  const crmStatus = crm.data?.crm_statuses as unknown as { slug: string; label: string; blocks_contact: boolean } | null;
  const blocked = Boolean(crmStatus?.blocks_contact);
  const editable = canEditCrm(session.role);
  const statusLabel = Object.fromEntries((statuses.data ?? []).map((s) => [s.slug, s.label]));

  return (
    <main className="mx-auto max-w-[1200px] px-4 py-6 md:px-8">
      <nav aria-label="Ruta" className="text-[13px] text-ink-soft">
        <Link href="/directorio" className="hover:underline">
          Directorio
        </Link>
        <span aria-hidden="true"> / </span>
        <span>{e.name}</span>
      </nav>

      {e.merged_into && (
        <p className="mt-4 rounded-md bg-warn-wash px-3 py-2 text-[13px] text-warn">
          Esta ficha se fusionó con otra.{" "}
          <Link className="underline" href={`/entidades/${e.merged_into}`}>
            Abrir la ficha principal
          </Link>
        </p>
      )}

      <header className="mt-3 flex flex-wrap items-start justify-between gap-4 border-b border-line pb-5">
        <div>
          <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.015em]">{e.name}</h1>
          <p className="mt-1 text-ink-soft">
            {ENTITY_TYPE[e.entity_type]}
            {e.category_name ? `, ${e.category_name.toLowerCase()}` : ""}
            {e.municipality_name ? ` en ${e.municipality_name}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {e.status !== "active" && <span className="tag bg-warn-wash text-warn">{STATUS[e.status]}</span>}
          <CrmBadge slug={crmStatus?.slug ?? null} label={crmStatus?.label ?? null} />
          {e.lat != null && (
            <Link href={`/mapa?id=${e.id}`} className="btn-secondary">
              Ver en el mapa
            </Link>
          )}
        </div>
      </header>

      {blocked && (
        <p role="note" className="mt-4 rounded-md bg-danger-wash px-3 py-2 text-[13px] text-danger">
          Marcada como «No contactar». No la incluyas en acciones comerciales.
        </p>
      )}
      {(dups.count ?? 0) > 0 && (
        <p className="mt-4 rounded-md bg-pine-wash px-3 py-2 text-[13px] text-pine-strong">
          Puede ser la misma entidad que otra ficha.{" "}
          <Link className="underline" href="/duplicados">
            Revisar posibles duplicados
          </Link>
        </p>
      )}

      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex flex-col gap-8">
          <section aria-labelledby="datos">
            <h2 id="datos" className="text-[16px] font-semibold">
              Datos y procedencia
            </h2>
            <p className="mt-1 text-[13px] text-ink-soft">Cada dato muestra de qué fuente procede. Si varias fuentes discrepan, se usa la más fiable.</p>
            <dl className="panel mt-3 divide-y divide-line">
              {FIELD_ORDER.filter((f) => byField.has(f)).map((f) => {
                const list = byField.get(f)!;
                const chosen = list.find((v) => v.is_selected) ?? list[0]!;
                const others = list.filter((v) => v.id !== chosen.id);
                return (
                  <div key={f} className="grid gap-1 px-4 py-3 sm:grid-cols-[140px_1fr]">
                    <dt className="text-[13px] text-ink-soft">{FIELD[f]}</dt>
                    <dd>
                      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                        <span className="break-words">
                          {renderValue(f, chosen.value, e.municipality_name)}
                          {f === "address" && e.address_is_personal && (
                            <span className="tag ml-2 bg-warn-wash text-warn" title="Parece un domicilio particular: se trata como dato personal">
                              Dato personal
                            </span>
                          )}
                        </span>
                        <span className="flex items-center gap-3 text-[12px] text-ink-soft">
                          <SourceMark source={chosen.source_id} />
                          <span title={`Confianza ${Math.round(chosen.confidence * 100)} %`}>{METHOD[chosen.method]}</span>
                          <span>{formatDate(chosen.observed_at)}</span>
                        </span>
                      </div>
                      {others.length > 0 && (
                        <details className="mt-1 text-[13px]">
                          <summary className="cursor-pointer text-atlantic">
                            {others.length === 1 ? "Otra fuente dice" : `Otras ${others.length} fuentes dicen`}
                          </summary>
                          <ul className="mt-1 flex flex-col gap-1 text-ink-soft">
                            {others.map((o) => (
                              <li key={o.id} className="flex flex-wrap gap-x-3">
                                <span className="text-ink">{renderValue(f, o.value, e.municipality_name)}</span>
                                <SourceMark source={o.source_id} />
                                <span>{METHOD[o.method]}</span>
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </section>

          {(contacts.data?.length ?? 0) > 0 && (
            <section aria-labelledby="contacto">
              <h2 id="contacto" className="text-[16px] font-semibold">
                Contacto
              </h2>
              <ul className="panel mt-3 divide-y divide-line">
                {contacts.data!.map((c) => (
                  <li key={`${c.kind}:${c.normalized}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                    <span>
                      {c.kind === "website" ? (
                        <a className="text-atlantic hover:underline" href={`https://${c.normalized}`} target="_blank" rel="noopener noreferrer nofollow">
                          {c.normalized}
                        </a>
                      ) : c.kind === "email" ? (
                        c.normalized
                      ) : (
                        formatPhone(c.normalized)
                      )}
                      {c.is_personal_data && (
                        <span className="tag ml-2 bg-warn-wash text-warn" title="Probablemente de una persona física (RGPD)">
                          Dato personal
                        </span>
                      )}
                    </span>
                    <SourceMark source={c.source_id} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-labelledby="fuentes">
            <h2 id="fuentes" className="text-[16px] font-semibold">
              Registros de origen
            </h2>
            <ul className="panel mt-3 divide-y divide-line">
              {(records.data ?? []).map((r, i) => {
                const sr = r.source_records as unknown as { source_id: string; external_id: string; last_seen_at: string; missing_since: string | null; first_seen_at: string };
                const url =
                  sr.source_id === "osm"
                    ? `https://www.openstreetmap.org/${sr.external_id}`
                    : null;
                return (
                  <li key={i} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                    <span className="flex flex-wrap items-center gap-3">
                      <SourceMark source={sr.source_id} showName />
                      {url ? (
                        <a href={url} target="_blank" rel="noopener noreferrer" className="text-atlantic hover:underline">
                          {sr.external_id}
                        </a>
                      ) : (
                        <span className="text-ink-soft">nº {sr.external_id}</span>
                      )}
                    </span>
                    <span className="text-[13px] text-ink-soft">
                      {sr.missing_since ? (
                        <span className="text-warn">No aparece desde {formatDate(sr.missing_since)}</span>
                      ) : (
                        <>Visto por última vez {formatDate(sr.last_seen_at)}</>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
            {(identifiers.data ?? []).some((i) => i.scheme === "nif") && (
              <p className="mt-2 text-[13px] text-ink-soft">
                NIF: {identifiers.data!.filter((i) => i.scheme === "nif").map((i) => i.value).join(", ")}
              </p>
            )}
            <p className="mt-2 text-[12px] text-ink-faint">
              {Object.entries(SOURCE)
                .filter(([k]) => (records.data ?? []).some((r) => (r.source_records as unknown as { source_id: string }).source_id === k) || (k === "cartociudad" && byField.get("location")?.some((v) => v.source_id === k)))
                .map(([k]) => ({ osm: "© Colaboradores de OpenStreetMap (ODbL)", red_galicia: "Xunta de Galicia (CC BY-SA 4.0)", cartociudad: "CartoCiudad © IGN (CC BY 4.0)", manual: "" })[k])
                .filter(Boolean)
                .join(". ")}
            </p>
          </section>
        </div>

        <aside className="flex flex-col gap-6">
          <section aria-labelledby="ubicacion" className="flex flex-col gap-2">
            <h2 id="ubicacion" className="text-[16px] font-semibold">
              Ubicación
            </h2>
            {e.lat != null && e.lon != null ? (
              <MiniMap lon={e.lon} lat={e.lat} approximate={!["exact", "address"].includes(e.location_precision)} />
            ) : (
              <p className="panel px-4 py-6 text-ink-soft">Sin coordenadas fiables: no aparece en el mapa.</p>
            )}
            <PrecisionMeter precision={e.location_precision} />
          </section>

          <section aria-labelledby="comercial" className="panel flex flex-col gap-5 p-4">
            <h2 id="comercial" className="text-[16px] font-semibold">
              Seguimiento comercial
            </h2>
            <StatusForm
              entityId={e.id}
              statuses={statuses.data ?? []}
              currentStatusId={crm.data?.status_id ?? null}
              currentPriority={crm.data?.priority ?? null}
              disabled={!editable}
            />
            {!editable && <p className="text-[13px] text-ink-soft">Tu rol es de solo lectura.</p>}
            {editable && <NoteForm entityId={e.id} blocked={blocked} />}

            <div>
              <h3 className="text-[14px] font-semibold">Notas</h3>
              {(notes.data?.length ?? 0) === 0 ? (
                <p className="mt-1 text-[13px] text-ink-soft">Sin notas todavía.</p>
              ) : (
                <ul className="mt-2 flex flex-col gap-3">
                  {notes.data!.map((n) => (
                    <li key={n.id} className="border-l-2 border-line pl-3">
                      <p className="whitespace-pre-wrap">{n.body}</p>
                      <div className="mt-1 flex gap-3 text-[12px] text-ink-faint">
                        <span>{formatDate(n.created_at, true)}</span>
                        {(n.author_id === session.userId || session.role === "admin") && (
                          <form action={deleteNote.bind(null, e.id, n.id)}>
                            <button className="text-ink-soft underline-offset-2 hover:text-danger hover:underline">Eliminar</button>
                          </form>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {(events.data?.length ?? 0) > 0 && (
              <div>
                <h3 className="text-[14px] font-semibold">Historial</h3>
                <ol className="mt-2 flex flex-col gap-1.5 text-[13px] text-ink-soft">
                  {events.data!.map((ev) => (
                    <li key={ev.id}>
                      {formatDate(ev.created_at, true)}:{" "}
                      {ev.kind === "status_changed"
                        ? ev.from_value
                          ? `estado de ${statusLabel[ev.from_value as string] ?? ev.from_value} a ${statusLabel[ev.to_value as string] ?? ev.to_value}`
                          : `estado ${statusLabel[ev.to_value as string] ?? ev.to_value}`
                        : ev.kind === "note_added"
                          ? "nota añadida"
                          : ev.kind === "note_deleted"
                            ? "nota eliminada"
                            : ev.kind === "priority_changed"
                              ? "prioridad cambiada"
                              : "responsable cambiado"}
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </section>

          <p className="text-[12px] text-ink-faint">
            En la base desde {formatDate(e.first_seen_at)}. Datos de fuentes revisados el {formatDate(e.last_seen_at)}.
          </p>
        </aside>
      </div>
    </main>
  );
}
