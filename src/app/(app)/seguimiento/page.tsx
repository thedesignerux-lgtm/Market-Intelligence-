import Link from "next/link";
import { CrmBadge, EmptyState, ErrorNote, PageHeader, PriorityTag } from "@/components/ui";
import { PRIORITY, formatDay, todayMadrid } from "@/lib/labels";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Seguimiento" };

interface FollowUp {
  entity_id: string;
  name: string;
  municipality_name: string | null;
  next_action: string;
  next_action_at: string;
  overdue: boolean;
  priority: number | null;
  crm_status: string;
  crm_status_label: string;
  is_buyer: boolean;
  is_seller: boolean;
}

const VIEWS = {
  vencidas: "Vencidas",
  proximas: "Hoy y próximas",
  todas: "Todas",
} as const;
type View = keyof typeof VIEWS;

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;

export default async function FollowUpPage({ searchParams }: { searchParams: Promise<Params> }) {
  const session = await getSession();
  const sp = await searchParams;
  const vista: View = (one(sp.vista) as View) in VIEWS ? (one(sp.vista) as View) : "todas";
  const rolRaw = one(sp.rol);
  const rol = rolRaw === "comprador" || rolRaw === "vendedor" ? rolRaw : undefined;
  const prioRaw = one(sp.prioridad);
  const prioridad = prioRaw && ["1", "2", "3"].includes(prioRaw) ? Number(prioRaw) : undefined;
  const today = todayMadrid();

  const supabase = await createClient();
  let query = supabase
    .from("follow_ups")
    .select("entity_id, name, municipality_name, next_action, next_action_at, overdue, priority, crm_status, crm_status_label, is_buyer, is_seller")
    .eq("workspace_id", session.workspaceId!)
    .order("next_action_at")
    .order("priority", { nullsFirst: false })
    .limit(500);
  if (vista === "vencidas") query = query.lt("next_action_at", today);
  if (vista === "proximas") query = query.gte("next_action_at", today);
  if (rol === "comprador") query = query.eq("is_buyer", true);
  if (rol === "vendedor") query = query.eq("is_seller", true);
  if (prioridad) query = query.eq("priority", prioridad);

  const [{ data, error }, kpiRes] = await Promise.all([
    query.returns<FollowUp[]>(),
    supabase.rpc("dashboard_kpis", { p_workspace: session.workspaceId! }),
  ]);
  const k = kpiRes.data as { first_contact: number; follow_ups: number; overdue: number } | null;
  const rows = data ?? [];
  const href = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams(
      Object.entries({ vista, rol, prioridad: prioridad?.toString(), ...patch }).filter((e): e is [string, string] => Boolean(e[1]) && !(e[0] === "vista" && e[1] === "todas")),
    );
    return p.size ? `/seguimiento?${p}` : "/seguimiento";
  };

  return (
    <main className="mx-auto max-w-[1280px] px-4 py-6 md:px-8">
      <PageHeader
        title="Seguimiento comercial"
        description="Próximas acciones con compradores y vendedores. La acción y su fecha se registran en la ficha de cada entidad."
      />

      {k && (
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <Link href={href({ vista: "vencidas" })} className="panel p-4 hover:border-line-strong">
            <span className="block text-[13px] text-ink-soft">Acciones vencidas</span>
            <span className={`block text-[24px] font-semibold ${k.overdue > 0 ? "text-danger" : ""}`}>{k.overdue}</span>
          </Link>
          <Link href={href({ vista: "todas" })} className="panel p-4 hover:border-line-strong">
            <span className="block text-[13px] text-ink-soft">Acciones programadas</span>
            <span className="block text-[24px] font-semibold">{k.follow_ups}</span>
          </Link>
          <Link href="/directorio?seguimiento=primer_contacto" className="panel p-4 hover:border-line-strong">
            <span className="block text-[13px] text-ink-soft">Pendientes de primer contacto</span>
            <span className="block text-[24px] font-semibold">{k.first_contact}</span>
            <span className="block text-[12px] text-ink-soft">Con contacto disponible y sin gestionar</span>
          </Link>
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Vista" className="flex flex-wrap gap-1.5">
          {(Object.keys(VIEWS) as View[]).map((v) => (
            <Link
              key={v}
              href={href({ vista: v })}
              aria-current={vista === v ? "page" : undefined}
              className={vista === v ? "btn bg-sidebar text-white" : "btn border border-line bg-surface text-ink-soft hover:border-line-strong hover:text-ink"}
            >
              {VIEWS[v]}
            </Link>
          ))}
        </nav>
        <form action="/seguimiento" className="flex flex-wrap items-end gap-2">
          {vista !== "todas" && <input type="hidden" name="vista" value={vista} />}
          <label className="flex flex-col gap-1">
            <span className="label">Rol</span>
            <select name="rol" defaultValue={rol ?? ""} className="field">
              <option value="">Todos</option>
              <option value="comprador">Compradores</option>
              <option value="vendedor">Vendedores</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="label">Prioridad</span>
            <select name="prioridad" defaultValue={prioridad?.toString() ?? ""} className="field">
              <option value="">Todas</option>
              {[1, 2, 3].map((p) => (
                <option key={p} value={p}>
                  {PRIORITY[p]!.label}
                </option>
              ))}
            </select>
          </label>
          <button className="btn-secondary">Filtrar</button>
        </form>
      </div>

      <div className="mt-4">
        {error ? (
          <ErrorNote>No se pudo cargar el seguimiento. Recarga la página.</ErrorNote>
        ) : rows.length === 0 ? (
          <EmptyState title={vista === "vencidas" ? "No hay acciones vencidas" : "No hay acciones programadas"}>
            Abre la ficha de una entidad y añade la próxima acción con su fecha. Para empezar, revisa las{" "}
            <Link className="text-atlantic underline" href="/directorio?seguimiento=primer_contacto">
              entidades pendientes de primer contacto
            </Link>
            .
          </EmptyState>
        ) : (
          <div className="panel overflow-x-auto">
            <table className="w-full min-w-[820px] text-left">
              <thead className="border-b border-line text-[13px] text-ink-soft">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Fecha</th>
                  <th className="px-4 py-2.5 font-medium">Entidad</th>
                  <th className="px-4 py-2.5 font-medium">Rol</th>
                  <th className="px-4 py-2.5 font-medium">Acción prevista</th>
                  <th className="px-4 py-2.5 font-medium">Prioridad</th>
                  <th className="px-4 py-2.5 font-medium">Estado</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.entity_id} className={`border-b border-line last:border-0 ${r.overdue ? "bg-danger-wash/40" : ""}`}>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <span className={r.overdue ? "font-medium text-danger" : ""}>{formatDay(r.next_action_at)}</span>
                      {r.overdue && <span className="tag ml-2 bg-danger-wash text-danger">Vencida</span>}
                      {r.next_action_at === today && <span className="tag ml-2 bg-warn-wash text-warn">Hoy</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      <Link href={`/entidades/${r.entity_id}`} className="font-medium hover:underline">
                        {r.name}
                      </Link>
                      {r.municipality_name && <div className="text-[12px] text-ink-soft">{r.municipality_name}</div>}
                    </td>
                    <td className="px-4 py-2.5 text-ink-soft">{[r.is_buyer && "Comprador", r.is_seller && "Vendedor"].filter(Boolean).join(" y ") || "—"}</td>
                    <td className="max-w-[320px] px-4 py-2.5">{r.next_action}</td>
                    <td className="px-4 py-2.5">
                      <PriorityTag priority={r.priority} />
                    </td>
                    <td className="px-4 py-2.5">
                      <CrmBadge slug={r.crm_status} label={r.crm_status_label} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
