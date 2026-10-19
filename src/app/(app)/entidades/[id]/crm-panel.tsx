"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import { addNote, setCrmStatus, setRoles, type ActionResult } from "./actions";

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
  currentNextAction,
  currentNextActionAt,
  disabled,
}: {
  entityId: string;
  statuses: Status[];
  currentStatusId: string | null;
  currentPriority: number | null;
  currentNextAction: string | null;
  currentNextActionAt: string | null;
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
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_160px] lg:grid-cols-1">
        <label className="flex min-w-0 flex-col gap-1">
          <span className="label">Próxima acción</span>
          <input
            name="next_action"
            defaultValue={currentNextAction ?? ""}
            maxLength={200}
            placeholder="Llamada inicial, enviar propuesta…"
            disabled={disabled}
            className="field"
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1 lg:max-w-[180px]">
          <span className="label">Fecha</span>
          <input name="next_action_at" type="date" defaultValue={currentNextActionAt ?? ""} disabled={disabled} className="field w-full min-w-0" />
        </label>
      </div>
      {!disabled && (
        <div className="flex items-center gap-3">
          <button className="btn-primary" disabled={pending}>
            {pending ? "Guardando…" : "Guardar seguimiento"}
          </button>
          <span aria-live="polite" className="text-[13px]">
            {state.error ? <span className="text-danger">{state.error}</span> : state.ok ? <span className="text-pine">Guardado</span> : null}
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

interface Roles {
  buyer_potential: boolean;
  seller_potential: boolean;
  buyer_participant: boolean;
  seller_participant: boolean;
  buyer_evidence: string | null;
  seller_evidence: string | null;
  buyer_verified_at: string | null;
  seller_verified_at: string | null;
  is_manual: boolean;
}

/** Clasificación comercial. La participación en GROPO solo la editan admin y editor, con prueba. */
export function RolesForm({
  entityId,
  roles,
  canEdit,
  canVerify,
}: {
  entityId: string;
  roles: Roles;
  canEdit: boolean;
  canVerify: boolean;
}) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(setRoles.bind(null, entityId), { ok: false, error: null });
  const fmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Madrid" }) : "";
  return (
    <form action={action} className="flex flex-col gap-3">
      <fieldset className="flex flex-col gap-2" disabled={!canEdit}>
        <legend className="label mb-1">Potencial</legend>
        <label className="flex items-start gap-2">
          <input type="checkbox" name="buyer_potential" defaultChecked={roles.buyer_potential} className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--atlantic)]" />
          <span>
            Comprador potencial
            <span className="block text-[12px] text-ink-soft">Podría organizar compras colectivas</span>
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input type="checkbox" name="seller_potential" defaultChecked={roles.seller_potential} className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--pine)]" />
          <span>
            Vendedor potencial
            <span className="block text-[12px] text-ink-soft">Podría vender productos a través de GROPO</span>
          </span>
        </label>
        {!roles.is_manual && <p className="text-[12px] text-ink-faint">Propuesto según el tipo de entidad. Puedes cambiarlo.</p>}
      </fieldset>

      <fieldset className="flex flex-col gap-2 border-t border-line pt-3">
        <p className="label">Participación verificada en GROPO</p>
        {canVerify ? (
          <>
            <ParticipantField
              kind="buyer"
              label="Participa como comprador"
              checked={roles.buyer_participant}
              evidence={roles.buyer_evidence}
              verifiedAt={fmt(roles.buyer_verified_at)}
            />
            <ParticipantField
              kind="seller"
              label="Participa como vendedor"
              checked={roles.seller_participant}
              evidence={roles.seller_evidence}
              verifiedAt={fmt(roles.seller_verified_at)}
            />
          </>
        ) : (
          <>
            {/* Se reenvían los valores actuales: solo admin y editor pueden cambiarlos. */}
            {roles.buyer_participant && <input type="hidden" name="buyer_participant" value="on" />}
            {roles.buyer_evidence && <input type="hidden" name="buyer_evidence" value={roles.buyer_evidence} />}
            {roles.seller_participant && <input type="hidden" name="seller_participant" value="on" />}
            {roles.seller_evidence && <input type="hidden" name="seller_evidence" value={roles.seller_evidence} />}
            <p className="text-[13px]">
              {roles.buyer_participant || roles.seller_participant
                ? [roles.buyer_participant && `Comprador (verificado ${fmt(roles.buyer_verified_at)})`, roles.seller_participant && `Vendedor (verificado ${fmt(roles.seller_verified_at)})`]
                    .filter(Boolean)
                    .join(" · ")
                : "No participa todavía."}
            </p>
            <p className="text-[12px] text-ink-faint">Solo administradores y editores pueden marcar la participación.</p>
          </>
        )}
      </fieldset>

      {canEdit && (
        <div className="flex items-center gap-3">
          <button className="btn-secondary" disabled={pending}>
            {pending ? "Guardando…" : "Guardar clasificación"}
          </button>
          <span aria-live="polite" className="text-[13px]">
            {state.error ? <span className="text-danger">{state.error}</span> : state.ok ? <span className="text-pine">Guardado</span> : null}
          </span>
        </div>
      )}
    </form>
  );
}

function ParticipantField({
  kind,
  label,
  checked,
  evidence,
  verifiedAt,
}: {
  kind: "buyer" | "seller";
  label: string;
  checked: boolean;
  evidence: string | null;
  verifiedAt: string;
}) {
  const [on, setOn] = useState(checked);
  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex items-center gap-2">
        <input type="checkbox" name={`${kind}_participant`} checked={on} onChange={(e) => setOn(e.target.checked)} className="h-4 w-4 accent-[var(--ink)]" />
        {label}
      </label>
      {on && (
        <label className="ml-6 flex flex-col gap-1">
          <span className="text-[12px] text-ink-soft">Prueba: ID o enlace de su cuenta o pedido en GROPO</span>
          <input
            name={`${kind}_evidence`}
            defaultValue={evidence ?? ""}
            required
            minLength={3}
            maxLength={500}
            placeholder="https://gropo.es/… o ID"
            className="field"
          />
          {checked && verifiedAt && <span className="text-[12px] text-ink-faint">Verificado el {verifiedAt}</span>}
        </label>
      )}
    </div>
  );
}
