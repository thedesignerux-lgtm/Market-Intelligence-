"use client";
import { useActionState, useEffect, useRef } from "react";
import { addNote, setCrmStatus, type ActionResult } from "./actions";

interface Status {
  id: string;
  slug: string;
  label: string;
  blocks_contact: boolean;
}

export function StatusForm({
  entityId,
  statuses,
  currentStatusId,
  currentPriority,
  disabled,
}: {
  entityId: string;
  statuses: Status[];
  currentStatusId: string | null;
  currentPriority: number | null;
  disabled: boolean;
}) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(setCrmStatus.bind(null, entityId), { ok: false, error: null });
  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="grid grid-cols-[1fr_120px] gap-2">
        <label className="flex flex-col gap-1">
          <span className="label">Estado</span>
          <select name="status_id" defaultValue={currentStatusId ?? ""} required disabled={disabled} className="field">
            <option value="" disabled>
              Elige un estado
            </option>
            {statuses.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="label">Prioridad</span>
          <select name="priority" defaultValue={currentPriority?.toString() ?? ""} disabled={disabled} className="field">
            <option value="">Sin prioridad</option>
            <option value="1">Alta</option>
            <option value="2">Media</option>
            <option value="3">Baja</option>
          </select>
        </label>
      </div>
      {!disabled && (
        <div className="flex items-center gap-3">
          <button className="btn-primary" disabled={pending}>
            {pending ? "Guardando…" : "Guardar estado"}
          </button>
          <span aria-live="polite" className="text-[13px]">
            {state.error ? <span className="text-danger">{state.error}</span> : state.ok ? <span className="text-pine">Estado guardado</span> : null}
          </span>
        </div>
      )}
    </form>
  );
}

export function NoteForm({ entityId, blocked }: { entityId: string; blocked: boolean }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(addNote.bind(null, entityId), { ok: false, error: null });
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state]);
  return (
    <form ref={ref} action={action} className="flex flex-col gap-2">
      <label className="flex flex-col gap-1">
        <span className="label">Nueva nota</span>
        <textarea
          name="body"
          rows={3}
          maxLength={10000}
          required
          placeholder={blocked ? "Registra solo información interna: esta entidad no quiere ser contactada." : "Qué se habló, próximos pasos…"}
          className="field h-auto py-2"
        />
      </label>
      <div className="flex items-center gap-3">
        <button className="btn-secondary" disabled={pending}>
          {pending ? "Guardando…" : "Añadir nota"}
        </button>
        <span aria-live="polite" className="text-[13px]">
          {state.error && <span className="text-danger">{state.error}</span>}
        </span>
      </div>
    </form>
  );
}
