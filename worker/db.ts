import pg from "pg";

export type Db = pg.Pool;
export type Tx = pg.PoolClient;

/**
 * Conexiones remotas (Supabase) siempre cifradas con TLS.
 * Si se define DATABASE_CA_CERT (certificado raíz de Supabase, en PEM), además se verifica el servidor;
 * sin él la conexión va cifrada pero sin verificar el certificado (el de Supabase no es de una CA pública).
 * Las conexiones locales (socket o localhost) van sin TLS.
 */
function sslConfig(connectionString: string): pg.PoolConfig["ssl"] {
  const local = /@(localhost|127\.0\.0\.1)[:/]|host=\/|^postgres(ql)?:\/\/[^@]*@\//.test(connectionString);
  if (local || /[?&]sslmode=/.test(connectionString)) return undefined;
  const ca = process.env.DATABASE_CA_CERT;
  return ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false };
}

export function createPool(connectionString: string): Db {
  const pool = new pg.Pool({ connectionString, ssl: sslConfig(connectionString), max: 4, application_name: "market-intelligence-worker" });
  pool.on("error", (err) => console.error("[db] error en conexión inactiva:", err.message));
  return pool;
}

/** Ejecuta fn dentro de una transacción. */
export async function withTx<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
