"use client";
import { useActionState, useState } from "react";
import { requestImport, type ImportState } from "./actions";

export function RequestImportForm({ municipalities }: { municipalities: { code: string; name: string }[] }) {
  const [state, action, pending] = useActionState<ImportState, FormData>(requestImport, { ok: false, error: null });
  const [scope, setScope] = useState("municipio");
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
        <span className="label">Alcance</span>
        <select name="scope" className="field" value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="municipio">Un municipio</option>
          <option value="15">Provincia de A Coruña</option>
          <option value="27">Provincia de Lugo</option>
          <option value="32">Provincia de Ourense</option>
          <option value="36">Provincia de Pontevedra</option>
          <option value="galicia">Toda Galicia</option>
        </select>
      </label>
      <label className={`flex flex-col gap-1 ${scope === "municipio" ? "" : "hidden"}`}>
        <span className="label">Municipio (código INE)</span>
        <input
          name="municipality"
          list="municipios"
          required={scope === "municipio"}
          disabled={scope !== "municipio"}
          inputMode="numeric"
          pattern="\d{5}"
          placeholder="15078"
          className="field w-[200px]"
        />
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
