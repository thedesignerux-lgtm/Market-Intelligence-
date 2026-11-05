// Cortacircuitos del importador: una fuente que no responde cancela la importación
// en lugar de dejarla «en curso» reintentando noche tras noche.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "../../worker/http";
import type { Config } from "../../worker/config";
import type { Db } from "../../worker/db";
import type { ImportTask } from "../../worker/handlers";

const runRedTask = vi.fn();

vi.mock("../../worker/handlers", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../worker/handlers")>();
  return { ...real, runRedTask: (...args: unknown[]) => runRedTask(...args) };
});

// El geocodificador no llega a usarse porque el manejador falla antes.
vi.mock("../../worker/geocode", () => ({
  Geocoder: class {
    stats = { geocoded: 0, not_geocoded: 0 };
  },
}));

const { drainQueue, SOURCE_DOWN_THRESHOLD } = await import("../../worker/runner");

const RUN = "11111111-1111-1111-1111-111111111111";
const config = { WORKER_ID: "test-worker" } as Config;

/** Base de datos falsa: registra el SQL ejecutado y sirve tareas de la cola. */
function fakeDb(pending: number) {
  const sql: string[] = [];
  let served = 0;
  const db = {
    query: async (text: string) => {
      sql.push(text);
      if (text.includes("claim_import_task")) {
        if (served >= pending) return { rows: [] };
        served += 1;
        const task: ImportTask = {
          id: served,
          run_id: RUN,
          task_key: `red_galicia:1507${served}`,
          params: { municipality: `1507${served}` },
          attempts: 1,
          max_attempts: 5,
        };
        return { rows: [task] };
      }
      return { rows: [] };
    },
  } as unknown as Db;
  return { db, sql, cancels: () => sql.filter((s) => s.includes("control_import")).length };
}

beforeEach(() => {
  runRedTask.mockReset();
});

describe("cortacircuitos por fuente caída", () => {
  it("cancela la importación tras suficientes fallos de red seguidos", async () => {
    runRedTask.mockRejectedValue(new HttpError("Error de red en abertos.xunta.gal: fetch failed", null, true));
    const { db, sql, cancels } = fakeDb(SOURCE_DOWN_THRESHOLD + 2);

    await drainQueue(db, config);

    expect(cancels()).toBe(1);
    expect(sql.some((s) => s.includes("import_issues") && s.includes("source_unreachable"))).toBe(true);
  });

  it("no cancela si los fallos son de datos y no de red", async () => {
    runRedTask.mockRejectedValue(new Error("fila sin nombre"));
    const { db, cancels } = fakeDb(SOURCE_DOWN_THRESHOLD + 2);

    await drainQueue(db, config);

    expect(cancels()).toBe(0);
  });

  it("no cancela si una respuesta correcta rompe la racha", async () => {
    const red = new HttpError("Error de red en abertos.xunta.gal: fetch failed", null, true);
    let n = 0;
    runRedTask.mockImplementation(async () => {
      n += 1;
      // Una tarea correcta cada tres: la racha nunca llega al umbral.
      if (n % 3 === 0) return { created: 0 };
      throw red;
    });
    const { db, cancels } = fakeDb(SOURCE_DOWN_THRESHOLD * 3);

    await drainQueue(db, config);

    expect(cancels()).toBe(0);
  });

  it("no cancela importaciones sanas", async () => {
    runRedTask.mockResolvedValue({ created: 1 });
    const { db, cancels } = fakeDb(5);

    await drainQueue(db, config);

    expect(cancels()).toBe(0);
  });
});
