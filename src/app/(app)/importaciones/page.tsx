import { Coverage } from "@/components/coverage";
import { EmptyState, PageHeader } from "@/components/ui";
import { RUN_STATUS, SOURCE, formatDate } from "@/lib/labels";
import { canCurate, getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { controlRun } from "./actions";
import { RequestImportForm } from "./request-form";

export const metadata = { title: "Importaciones" };

const STAT_LABEL: Record<string, string> = {
  created: "nuevas",
  updated: "actualizadas",
  unchanged: "sin cambios",
  linked: "unidas a una ficha existente",
  created_for_review: "con posible duplicado",
  failed_records: "con error",
  marked_missing: "ya no aparecen en la fuente",
};

export default async function ImportsPage() {
  const session = await getSession();
  const curator = canCurate(session.role);
  const supabase = await createClient();
  const [{ data: runs }, { data: munis }] = await Promise.all([
    supabase.from("import_runs").select("id, source_id, status, scope, stats, source_version, created_at, started_at, finished_at").order("created_at", { ascending: false }).limit(20),
    supabase.from("admin_areas").select("code, name").eq("level", "municipio").order("name"),
  ]);
  const runIds = (runs ?? []).map((r) => r.id);
  const { data: issues } = runIds.length
    ? await supabase.from("import_issues").select("run_id, severity, code, message").in("run_id", runIds).order("id").limit(500)
    : { data: [] as { run_id: string; severity: string; code: string; message: string }[] };
  const muniName = new Map((munis ?? []).map((m) => [m.code, m.name]));

  // El importador corre en GitHub Actions: al pedir una importación se lanza en seguida (si está configurado)
  // y, en todo caso, cada noche. Si algo lleva más de 15 minutos en cola, se avisa.
  const immediate = Boolean(process.env.GITHUB_DISPATCH_TOKEN);
  const stalled = (runs ?? []).some((r) => r.status === "queued" && Date.now() - new Date(r.created_at).getTime() > 15 * 60_000);

  return (
    <main className="mx-auto max-w-[1100px] px-4 py-6 md:px-8">
      <PageHeader
        title="Importaciones"
        description="Trae entidades de fuentes abiertas, municipio a municipio. Repetir una importación actualiza las fichas existentes sin duplicarlas."
      />

      {curator && (
        <section className="panel mt-6 p-4" aria-labelledby="nueva">
          <h2 id="nueva" className="mb-3 text-[16px] font-semibold">
            Nueva importación
          </h2>
          <RequestImportForm municipalities={(munis ?? []).map((m) => ({ code: m.code, name: m.name }))} />
        </section>
      )}

      {stalled && (
        <p role="alert" className="mt-4 rounded-md bg-warn-wash px-3 py-2 text-[13px] text-warn">
          {immediate
            ? "Hay importaciones en cola desde hace más de 15 minutos. Revisa la última ejecución en GitHub → Actions → «Importador»."
            : "Hay importaciones en cola. Se procesarán en la ejecución automática de esta noche (o lánzala a mano en GitHub → Actions → «Importador» → «Run workflow»)."}
        </p>
      )}

      <section className="mt-8" aria-labelledby="historial">
        <h2 id="historial" className="text-[16px] font-semibold">
          Historial
        </h2>
        {(runs?.length ?? 0) === 0 ? (
          <div className="mt-3">
            <EmptyState title="Aún no hay importaciones" />
          </div>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {runs!.map((r) => {
              const scope = r.scope as { municipalities?: string[] };
              const stats = r.stats as Record<string, number>;
              const runIssues = (issues ?? []).filter((i) => i.run_id === r.id);
              const errors = runIssues.filter((i) => i.severity === "error").length;
              return (
                <li key={r.id} className="panel p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">
                        {SOURCE[r.source_id]?.name ?? r.source_id} en{" "}
                        {(scope.municipalities ?? []).map((c) => muniName.get(c) ?? c).join(", ")}
                      </p>
                      <p className="text-[13px] text-ink-soft">
                        Solicitada {formatDate(r.created_at, true)}
                        {r.source_version ? `. Datos de origen: ${r.source_version}` : ""}
                      </p>
                    </div>
                    <span
                      className={`tag ${
                        r.status === "succeeded" ? "bg-pine-wash text-pine-strong" : r.status === "failed" ? "bg-danger-wash text-danger" : r.status === "partial" ? "bg-warn-wash text-warn" : "bg-paper text-ink-soft"
                      }`}
                    >
                      {RUN_STATUS[r.status]}
                    </span>
                  </div>
                  {Object.keys(stats).some((k) => k in STAT_LABEL && stats[k]) && (
                    <p className="mt-2 text-[13px]">
                      {Object.entries(STAT_LABEL)
                        .filter(([k]) => stats[k])
                        .map(([k, label]) => `${stats[k]} ${label}`)
                        .join(", ")}
                    </p>
                  )}
                  {runIssues.length > 0 && (
                    <details className="mt-2 text-[13px]">
                      <summary className="cursor-pointer text-atlantic">
                        {runIssues.length} avisos{errors ? `, ${errors} errores` : ""}
                      </summary>
                      <ul className="mt-2 flex max-h-60 flex-col gap-1 overflow-auto text-ink-soft">
                        {runIssues.map((i, n) => (
                          <li key={n} className={i.severity === "error" ? "text-danger" : ""}>
                            {i.message}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                  {curator && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {(r.status === "queued" || r.status === "running") && (
                        <form action={controlRun.bind(null, r.id, "pause")}>
                          <button className="btn-secondary">Pausar</button>
                        </form>
                      )}
                      {r.status === "paused" && (
                        <form action={controlRun.bind(null, r.id, "resume")}>
                          <button className="btn-secondary">Reanudar</button>
                        </form>
                      )}
                      {(r.status === "partial" || r.status === "failed") && (
                        <form action={controlRun.bind(null, r.id, "retry_failed")}>
                          <button className="btn-secondary">Reintentar lo fallido</button>
                        </form>
                      )}
                      {["queued", "running", "paused"].includes(r.status) && (
                        <form action={controlRun.bind(null, r.id, "cancel")}>
                          <button className="btn-danger">Cancelar</button>
                        </form>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <section className="mt-8" aria-labelledby="cobertura">
        <h2 id="cobertura" className="text-[16px] font-semibold">
          Cobertura de datos
        </h2>
        <p className="mt-1 mb-3 max-w-[70ch] text-[13px] text-ink-soft">
          Qué hay importado en cada territorio. Que un municipio aparezca no significa que estén todas sus entidades: depende de lo que publica cada fuente.
        </p>
        <Coverage />
      </section>
    </main>
  );
}
