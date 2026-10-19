import { Nav } from "@/components/nav";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "../login/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();

  if (!session.workspaceId) {
    return (
      <main className="grid min-h-dvh place-items-center px-4">
        <div className="max-w-[440px]">
          <h1 className="text-[20px] font-semibold">Tu cuenta todavía no tiene acceso</h1>
          <p className="mt-2 text-ink-soft">
            Has entrado como {session.email}, pero no perteneces a ningún equipo. Pide a un administrador que te añada.
          </p>
          <form action={signOut} className="mt-5">
            <button className="btn-secondary">Salir</button>
          </form>
        </div>
      </main>
    );
  }

  const supabase = await createClient();
  const { count } = await supabase
    .from("duplicate_candidates")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[216px_1fr]">
      <aside className="flex flex-col gap-4 bg-sidebar px-3 py-4 text-white md:sticky md:top-0 md:h-dvh md:gap-6 md:py-5">
        <div className="flex items-start justify-between gap-3 px-3">
          <div>
          <p className="text-[15px] font-semibold">Market Intelligence</p>
          {session.workspaceName && session.workspaceName !== "Market Intelligence" && (
            <p className="text-[12px] text-white/55">{session.workspaceName}</p>
          )}
          </div>
          <form action={signOut} className="md:hidden">
            <button className="text-[13px] text-white/75 underline-offset-2 hover:text-white hover:underline">Salir</button>
          </form>
        </div>
        <Nav pendingDuplicates={count ?? 0} />
        <div className="mt-auto hidden px-3 md:block">
          <p className="truncate text-[12px] text-white/55" title={session.email ?? ""}>
            {session.email}
          </p>
          <form action={signOut}>
            <button className="mt-1 text-[13px] text-white/75 underline-offset-2 hover:text-white hover:underline">Salir</button>
          </form>
        </div>
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
