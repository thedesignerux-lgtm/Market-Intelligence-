import Link from "next/link";
import type { EntityFilters } from "@/lib/entities";
import { FOLLOW_FILTER, PRIORITY, PROVINCES, ROLE_FILTER } from "@/lib/labels";

interface Props {
  action: string;
  filters: EntityFilters;
  categories: { id: string; name: string; parent_id: string | null }[];
  municipalities: { code: string; name: string }[];
  statuses: { slug: string; label: string }[];
  /** Campos que se fijan desde fuera (p. ej. la pestaña de rol del resumen) y no se muestran. */
  hidden?: (keyof EntityFilters)[];
}

/** Búsqueda y filtros del directorio. Formulario GET: los filtros quedan en la URL y se pueden compartir. */
export function EntityFilterForm({ action, filters: f, categories, municipalities, statuses, hidden = [] }: Props) {
  const show = (k: keyof EntityFilters) => !hidden.includes(k);
  const active = Object.entries(f).some(([k, v]) => v && !hidden.includes(k as keyof EntityFilters));
  return (
    <form action={action} role="search" aria-label="Buscar entidades" className="flex flex-wrap items-end gap-3">
      {hidden.map((k) => (f[k] ? <input key={k} type="hidden" name={k} value={f[k]} /> : null))}
      {f.tipo && <input type="hidden" name="tipo" value={f.tipo} />}
      {f.seguimiento && !hidden.includes("seguimiento") && <input type="hidden" name="seguimiento" value={f.seguimiento} />}
      <label className="flex min-w-[220px] flex-[2] flex-col gap-1">
        <span className="label">Buscar</span>
        <input name="q" defaultValue={f.q} placeholder="Nombre o dirección" className="field" type="search" />
      </label>
      <label className="flex min-w-[140px] flex-1 flex-col gap-1">
        <span className="label">Territorio</span>
        <select name="territorio" defaultValue={f.municipio ?? f.provincia ?? ""} className="field">
          <option value="">Toda Galicia</option>
          <optgroup label="Provincias">
            {PROVINCES.map((p) => (
              <option key={p.code} value={p.code}>
                {p.name}
              </option>
            ))}
          </optgroup>
          <optgroup label="Municipios con datos">
            {municipalities.map((m) => (
              <option key={m.code} value={m.code}>
                {m.name}
              </option>
            ))}
          </optgroup>
        </select>
      </label>
      <label className="flex min-w-[140px] flex-1 flex-col gap-1">
        <span className="label">Categoría</span>
        <select name="categoria" defaultValue={f.categoria ?? ""} className="field">
          <option value="">Todas</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.parent_id ? `  ${c.name}` : c.name}
            </option>
          ))}
        </select>
      </label>
      {show("rol") && (
        <label className="flex min-w-[140px] flex-1 flex-col gap-1">
          <span className="label">Rol</span>
          <select name="rol" defaultValue={f.rol ?? ""} className="field">
            <option value="">Todos</option>
            {Object.entries(ROLE_FILTER).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="flex min-w-[140px] flex-1 flex-col gap-1">
        <span className="label">Estado</span>
        <select name="estado" defaultValue={f.estado ?? ""} className="field">
          <option value="">Todos</option>
          <option value="sin_estado">Sin estado</option>
          {statuses.map((s) => (
            <option key={s.slug} value={s.slug}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex min-w-[140px] flex-1 flex-col gap-1">
        <span className="label">Prioridad</span>
        <select name="prioridad" defaultValue={f.prioridad ?? ""} className="field">
          <option value="">Todas</option>
          {[1, 2, 3].map((p) => (
            <option key={p} value={p}>
              {PRIORITY[p]!.label}
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-end gap-2">
        <button className="btn-primary" type="submit">
          Filtrar
        </button>
        {active && (
          <Link href={`${action}${hidden.some((k) => f[k]) ? `?${hidden.filter((k) => f[k]).map((k) => `${k}=${f[k]}`).join("&")}` : ""}`} className="btn-secondary">
            Limpiar
          </Link>
        )}
      </div>
      {f.seguimiento && !hidden.includes("seguimiento") && (
        <p className="basis-full text-[13px] text-ink-soft">
          Mostrando: <strong className="font-medium text-ink">{FOLLOW_FILTER[f.seguimiento]}</strong>.{" "}
          <Link className="text-atlantic hover:underline" href={`${action}?${new URLSearchParams(Object.entries({ ...f, seguimiento: undefined }).filter((e): e is [string, string] => Boolean(e[1])))}`}>
            Quitar este filtro
          </Link>
        </p>
      )}
    </form>
  );
}
