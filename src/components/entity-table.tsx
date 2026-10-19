import Link from "next/link";
import type { EntityRow } from "@/lib/entities";
import { formatDay, todayMadrid } from "@/lib/labels";
import { CrmBadge, PriorityTag, RoleTags } from "./ui";

/** Tabla compacta de entidades (resumen y directorio). */
export function EntityTable({ rows }: { rows: EntityRow[] }) {
  const today = todayMadrid();
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[980px] text-left">
        <thead className="border-b border-line text-[13px] text-ink-soft">
          <tr>
            <th className="px-4 py-2.5 font-medium">Nombre</th>
            <th className="px-4 py-2.5 font-medium">Categoría</th>
            <th className="px-4 py-2.5 font-medium">Ubicación</th>
            <th className="px-4 py-2.5 font-medium">Rol</th>
            <th className="px-4 py-2.5 font-medium">Estado</th>
            <th className="px-4 py-2.5 font-medium">Prioridad</th>
            <th className="px-4 py-2.5 font-medium">Contacto</th>
            <th className="px-4 py-2.5 font-medium">Próxima acción</th>
            <th className="relative px-2 py-2.5">
              {/* relative: el texto oculto no debe escapar del contenedor con scroll */}
              <span className="sr-only">Ficha</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const overdue = r.next_action_at != null && r.next_action_at < today;
            return (
              <tr key={r.id} className="border-b border-line last:border-0 hover:bg-paper/60">
                <td className="max-w-[300px] px-4 py-2.5">
                  <Link href={`/entidades/${r.id}`} className="font-medium hover:underline">
                    {r.name}
                  </Link>
                  {r.status === "unverified" && <div className="text-[12px] text-warn">Ya no aparece en su fuente</div>}
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-ink-soft">{r.category_name ?? "—"}</td>
                <td className="px-4 py-2.5">
                  {r.municipality_name ?? "—"}
                  {r.province_name && <div className="text-[12px] text-ink-soft">{r.province_name}</div>}
                </td>
                <td className="px-4 py-2.5">
                  <RoleTags roles={r} />
                </td>
                <td className="whitespace-nowrap px-4 py-2.5">
                  <CrmBadge slug={r.crm_status} label={r.crm_status_label} />
                </td>
                <td className="px-4 py-2.5">
                  <PriorityTag priority={r.priority} />
                </td>
                <td className="px-4 py-2.5">
                  {r.contact_blocked ? (
                    <span className="text-danger">No contactar</span>
                  ) : r.has_contact ? (
                    <span className="text-pine">Sí</span>
                  ) : (
                    <span className="text-ink-faint">No</span>
                  )}
                </td>
                <td className="max-w-[220px] px-4 py-2.5">
                  {r.next_action ? (
                    <>
                      <div className="truncate" title={r.next_action}>
                        {r.next_action}
                      </div>
                      <div className={`text-[12px] ${overdue ? "font-medium text-danger" : "text-ink-soft"}`}>
                        {overdue ? "Vencida · " : ""}
                        {formatDay(r.next_action_at)}
                      </div>
                    </>
                  ) : (
                    <span className="text-ink-faint">—</span>
                  )}
                </td>
                <td className="px-2 py-2.5">
                  <Link
                    href={`/entidades/${r.id}`}
                    aria-label={`Abrir la ficha de ${r.name}`}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-line text-ink-soft hover:border-line-strong hover:text-ink"
                  >
                    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M6 3l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
