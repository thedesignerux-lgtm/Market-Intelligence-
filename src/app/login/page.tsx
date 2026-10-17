import type { Metadata } from "next";
import { LoginForm } from "./form";

export const metadata: Metadata = { title: "Entrar" };

export default function LoginPage() {
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-[360px]">
        <Contours />
        <h1 className="mt-6 text-[22px] font-semibold tracking-[-0.01em]">Market Intelligence</h1>
        <p className="mt-1 text-ink-soft">Comercios y clubes de Galicia, con su procedencia.</p>
        <div className="panel mt-6 p-5">
          <LoginForm />
        </div>
        <p className="mt-4 text-[13px] text-ink-faint">
          Acceso solo para el equipo. Si necesitas una cuenta, pídesela a un administrador.
        </p>
      </div>
    </main>
  );
}

/** Marca: curvas de nivel, el motivo gráfico del producto. */
function Contours() {
  return (
    <svg width="44" height="44" viewBox="0 0 44 44" aria-hidden="true">
      <rect width="44" height="44" rx="9" fill="var(--ink)" />
      <path d="M8 30c5-8 10-10 15-7s9 2 13-6" stroke="var(--pine-wash)" strokeWidth="1.6" fill="none" />
      <path d="M8 35c6-6 11-7 16-4s9 2 12-3" stroke="var(--pine-wash)" strokeOpacity=".55" strokeWidth="1.6" fill="none" />
      <path d="M8 24c5-9 9-12 14-9s9 1 14-6" stroke="var(--pine-wash)" strokeOpacity=".3" strokeWidth="1.6" fill="none" />
      <circle cx="29" cy="15" r="2.6" fill="#7fc39c" />
    </svg>
  );
}
