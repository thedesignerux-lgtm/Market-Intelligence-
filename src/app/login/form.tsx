"use client";
import { useActionState } from "react";
import { signIn, type LoginState } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(signIn, { error: null, email: "" });
  return (
    <form action={action} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="label">Email</span>
        <input name="email" type="email" autoComplete="email" required defaultValue={state.email} className="field" />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="label">Contraseña</span>
        <input name="password" type="password" autoComplete="current-password" required autoFocus={Boolean(state.error)} className="field" />
      </label>
      {state.error && (
        <p role="alert" className="rounded-md bg-danger-wash px-3 py-2 text-[13px] text-danger">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending} className="btn-primary mt-1">
        {pending ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}
