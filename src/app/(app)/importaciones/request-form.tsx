"use client";
import { useActionState } from "react";
import { requestImport, type ImportState } from "./actions";

export function RequestImportForm({ municipalities }: { municipalities: { code: string; name: string }[] }) {
  const [state, action, pending] = useActionState<ImportState, FormData>(requestImport, { ok: false, error: null });
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1">
        <span className="label">Fuente</span>
        <select name="source" className="field" defaultValue="red_galicia">
          <option value="red_galicia">Clubes: Rexistro de Entidades Deportivas</option>
          <option value="osm">Comercios: OpenStreetMap</option>
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="label">Municipio (código INE)</span>
        <input name="municipality" list="municipios" required inputMode="numeric" pattern="\d{5}" placeholder="15078" className="field w-[200px]" />
        <datalist id="municipios">
          {municipalities.map((m) => (
            <option key={m.code} value={m.code}>
              {m.name}
            </option>
          ))}
        </datalist>
      </label>
      <button className="btn-primary" disabled={pending}>
        {pending ? "Solicitando…" : "Importar"}
      </button>
      <p aria-live="polite" className="basis-full text-[13px]">
        {state.error && <span className="text-danger">{state.error}</span>}
        {state.ok && <span className="text-pine">Importación en cola. Aparecerá abajo y se actualizará al recargar.</span>}
      </p>
    </form>
  );
}
