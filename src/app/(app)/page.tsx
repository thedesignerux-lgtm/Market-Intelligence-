import Link from "next/link";
import { EntityFilterForm } from "@/components/entity-filters";
import { EntityTable } from "@/components/entity-table";
import { EmptyState, ErrorNote, PriorityTag } from "@/components/ui";
import { filtersToParams, readFilters, searchEntities } from "@/lib/entities";
import { formatDay } from "@/lib/labels";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Resumen" };

interface Kpis {
  entities: number;
  buyers_potential: number;
  sellers_potential: number;
  participants: number;
  buyer_participants: number;
  seller_participants: number;
  first_contact: number;
  follow_ups: number;
  overdue: number;
  pending: number;
}

interface FollowUp {
  entity_id: string;
  name: string;
  municipality_name: string | null;
  next_action: string;
  next_action_at: string;
  overdue: boolean;
  priority: number | null;
  is_buyer: boolean;
  is_seller: boolean;
}

const TABS = [
  { rol: undefined, label: "Todas" },
  { rol: "comprador_potencial", label: "Compradores potenciales" },
  { rol: "vendedor_potencial", label: "Vendedores potenciales" },
  { rol: "participante", label: "Participantes" },
] as const;

const PANEL_ROWS = 10;
const nf = new Intl.NumberFormat("es-ES");
const plural = (n: number, one: string, many: string) => `${nf.format(n)} ${n === 1 ? one : many}`;

type Params = Record<string, string | string[] | undefined>;

export default async function SummaryPage({ searchParams }: { searchParams: Promise<Params> }) {
  const session = await getSession();
  const f = readFilters(await searchParams);
  const supabase = await createClient();

  const [kpiRes, followRes, list, { data: categories }, { data: munis }, { data: statuses }] = await Promise.all([
    supabase.rpc("dashboard_kpis", { p_workspace: session.workspaceId! }),
    supabase
      .from("follow_ups")
      .select("entity_id, name, municipality_name, next_action, next_action_at, overdue, priority, is_buyer, is_seller")
      .eq("workspace_id", session.workspaceId!)
      .order("next_action_at")
      .order("priority", { nullsFirst: false })
      .limit(6)
      .returns<FollowUp[]>(),
    searchEntities(supabase, session, f, { limit: PANEL_ROWS + 1 }),
    supabase.from("categories").select("id, name, parent_id").order("sort"),
    supabase.from("municipality_summary").select("municipality_code, municipality_name").order("municipality_name"),
    supabase.from("crm_statuses").select("slug, label").eq("workspace_id", session.workspaceId!).order("sort"),
  ]);
  const k = kpiRes.data as Kpis | null;
  const rows = list.rows.slice(0, PANEL_ROWS);
  const more = list.rows.length > PANEL_ROWS;
  const params = filtersToParams(f);
  const tabHref = (rol?: string) => {
    const p = new URLSearchParams(params);
    if (rol) p.set("rol", rol);
    else p.delete("rol");
    return p.size ? `/?${p}` : "/";
  };

  return (
    <main className="mx-auto max-w-[1280px] px-4 py-6 md:px-8">
      <header>
        <h1 className="text-[24px] font-semibold tracking-[-0.015em]">Resumen</h1>
        <p className="mt-1 text-ink-soft">Encuentra, contacta y clasifica oportunidades para GROPO.</p>
      </header>

      {kpiRes.error || !k ? (
        <div className="mt-5">
          <ErrorNote>No se pudieron calcular los indicadores. Recarga la página.</ErrorNote>
        </div>
      ) : (
        <section aria-label="Indicadores" className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            href="/directorio?rol=comprador_potencial"
            tone="atlantic"
            icon="people"
            title="Compradores potenciales"
            value={k.buyers_potential}
            detail="Clubes y asociaciones que aún no participan"
          />
          <KpiCard
            href="/directorio?rol=vendedor_potencial"
            tone="pine"
            icon="shop"
            title="Vendedores potenciales"
            value={k.sellers_potential}
            detail="Tiendas y distribuidores que aún no participan"
          />
          <KpiCard
            href="/directorio?rol=participante"
            tone="ink"
            icon="check"
            title="Participantes en GROPO"
            value={k.participants}
            detail={
              k.participants === 0
                ? "Ninguno verificado todavía"
                : `${plural(k.buyer_participants, "comprador", "compradores")} · ${plural(k.seller_participants, "vendedor", "vendedores")}`
            }
          />
          <KpiCard
            href="/seguimiento"
            tone={k.overdue > 0 ? "danger" : "warn"}
            icon="phone"
            title="Contactos pendientes"
            value={k.pending}
            detail={
              <>
                {nf.format(k.first_contact)} por primer contacto · {plural(k.follow_ups, "seguimiento", "seguimientos")}
                {k.overdue > 0 && <strong className="block font-semibold text-danger">{plural(k.overdue, "vencido", "vencidos")}</strong>}
              </>
            }
          />
        </section>
      )}

      <div className="mt-6 grid gap-6 2xl:grid-cols-[minmax(0,1fr)_340px]">
        <section aria-labelledby="entidades" className="panel min-w-0 2xl:order-1">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
            <h2 id="entidades" className="sr-only">
              Entidades
            </h2>
            <nav aria-label="Rol" className="flex flex-wrap gap-1.5">
              {TABS.map((t) => {
                const active = f.rol === t.rol;
                return (
                  <Link
                    key={t.label}
                    href={tabHref(t.rol)}
                    aria-current={active ? "page" : undefined}
                    className={active ? "btn bg-sidebar text-white" : "btn border border-line bg-surface text-ink-soft hover:border-line-strong hover:text-ink"}
                  >
                    {t.label}
                  </Link>
                );
              })}
            </nav>
            <Link href={`/directorio${params.size ? `?${params}` : ""}`} className="text-[13px] text-atlantic hover:underline">
              Abrir en el directorio
            </Link>
          </div>
          <div className="border-b border-line px-4 py-3">
            <EntityFilterForm
              action="/"
              filters={f}
              hidden={["rol"]}
              categories={categories ?? []}
              municipalities={(munis ?? []).map((m) => ({ code: m.municipality_code as string, name: m.municipality_name as string }))}
              statuses={statuses ?? []}
            />
          </div>
          {list.error ? (
            <div className="p-4">
              <ErrorNote>No se pudieron cargar las entidades. Recarga la página.</ErrorNote>
            </div>
          ) : rows.length === 0 ? (
            <div className="p-4">
              <EmptyState title="Ninguna entidad con estos filtros">
                {f.rol === "participante"
                  ? "Todavía no hay participantes verificados. Se marcan en la ficha de cada entidad, con la prueba de GROPO."
                  : "Prueba con menos filtros."}
              </EmptyState>
            </div>
          ) : (
            <>
              <EntityTable rows={rows} />
              <p className="border-t border-line px-4 py-3 text-[13px] text-ink-soft">
                {more ? `Primeras ${PANEL_ROWS} por orden alfabético. ` : ""}
                <Link href={`/directorio${params.size ? `?${params}` : ""}`} className="text-atlantic hover:underline">
                  {more ? "Ver todas en el directorio" : "Abrir en el directorio"}
                </Link>
              </p>
            </>
          )}
        </section>

        <section aria-labelledby="proximas" className="panel order-first h-fit 2xl:order-2">
          <div className="flex items-baseline justify-between border-b border-line px-4 py-3">
            <h2 id="proximas" className="text-[16px] font-semibold">
              Próximas acciones
            </h2>
            <Link href="/seguimiento" className="text-[13px] text-atlantic hover:underline">
              Ver todas
            </Link>
          </div>
          {followRes.error ? (
            <div className="p-4">
              <ErrorNote>No se pudieron cargar las acciones.</ErrorNote>
            </div>
          ) : (followRes.data ?? []).length === 0 ? (
            <p className="px-4 py-6 text-[13px] text-ink-soft">
              No hay acciones programadas. Añade la próxima acción y su fecha en la ficha de una entidad.
            </p>
          ) : (
            <ul className="grid divide-line md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-1 2xl:divide-y [&>li]:border-b [&>li]:border-line 2xl:[&>li]:border-b-0">
              {followRes.data!.map((a) => (
                <li key={a.entity_id}>
                  <Link href={`/entidades/${a.entity_id}`} className="flex gap-3 px-4 py-3 hover:bg-paper/60">
                    <DateBadge day={a.next_action_at} overdue={a.overdue} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{a.name}</span>
                      <span className="block truncate text-[13px] text-ink-soft">{a.next_action}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-ink-soft">
                        {a.is_buyer && <span>Comprador</span>}
                        {a.is_buyer && a.is_seller && <span aria-hidden="true">·</span>}
                        {a.is_seller && <span>Vendedor</span>}
                        {a.overdue && <span className="tag bg-danger-wash text-danger">Vencida</span>}
                        {a.priority != null && <PriorityTag priority={a.priority} />}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}

const TONES = {
  atlantic: { bg: "#e4edf6", fg: "var(--atlantic)" },
  pine: { bg: "var(--pine-wash)", fg: "var(--pine)" },
  ink: { bg: "#e9eeed", fg: "var(--ink)" },
  warn: { bg: "var(--warn-wash)", fg: "var(--warn)" },
  danger: { bg: "var(--danger-wash)", fg: "var(--danger)" },
};

const ICONS: Record<string, React.ReactNode> = {
  people: <path d="M8.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-6 9a6 6 0 0 1 12 0M16 4.5a3.3 3.3 0 0 1 0 6.4M21.5 20a5.6 5.6 0 0 0-4-5.4" />,
  shop: <path d="M4 10v10h16V10M3 6l1.5-3h15L21 6v1.5a2.5 2.5 0 0 1-4.5 1.5 2.5 2.5 0 0 1-4.5 0 2.5 2.5 0 0 1-4.5 0A2.5 2.5 0 0 1 3 7.5V6Zm7 14v-5h4v5" />,
  check: <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-4-9 2.8 2.8L16.5 9" />,
  phone: <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" />,
};

function KpiCard({
  href,
  tone,
  icon,
  title,
  value,
  detail,
}: {
  href: string;
  tone: keyof typeof TONES;
  icon: keyof typeof ICONS;
  title: string;
  value: number;
  detail: React.ReactNode;
}) {
  const t = TONES[tone];
  return (
    <Link href={href} className="panel flex items-start gap-4 p-4 transition-colors hover:border-line-strong">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg" style={{ background: t.bg, color: t.fg }} aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          {ICONS[icon]}
        </svg>
      </span>
      <span className="min-w-0">
        <span className="block text-[14px] font-medium text-ink-soft">{title}</span>
        <span className="block text-[28px] font-semibold leading-tight tracking-[-0.02em]">{nf.format(value)}</span>
        <span className="block text-[13px] text-ink-soft">{detail}</span>
      </span>
    </Link>
  );
}

function DateBadge({ day, overdue }: { day: string; overdue: boolean }) {
  const [, m, d] = day.split("-");
  const month = new Date(Date.UTC(2000, Number(m) - 1, 1)).toLocaleDateString("es-ES", { month: "short", timeZone: "UTC" }).replace(".", "");
  return (
    <span
      className={`grid h-11 w-11 shrink-0 place-items-center rounded-md text-center leading-none ${overdue ? "bg-danger-wash text-danger" : "bg-pine-wash text-pine-strong"}`}
      title={formatDay(day)}
    >
      <span>
        <span className="block text-[16px] font-semibold">{Number(d)}</span>
        <span className="block text-[10px] uppercase tracking-wide">{month}</span>
      </span>
    </span>
  );
}
