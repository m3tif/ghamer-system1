import { Pool, type PoolClient } from "pg";

/**
 * All application queries run as the restricted `ghamer_app` role.
 * Every request is wrapped in a transaction that sets `app.user_id`; Row Level Security
 * and the SECURITY DEFINER functions read it. A request without a user sees nothing.
 */
const g = globalThis as unknown as { __ghamerPool?: Pool };

export function getPool(): Pool {
  if (!g.__ghamerPool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    g.__ghamerPool = new Pool({ connectionString: url, max: Number(process.env.DB_POOL_MAX ?? 10) });
  }
  return g.__ghamerPool;
}

export async function tx<T>(userId: string | null, fn: (c: PoolClient) => Promise<T>, reason?: string): Promise<T> {
  const c = await getPool().connect();
  try {
    await c.query("begin");
    if (userId) await c.query("select set_config('app.user_id', $1, true)", [userId]);
    if (reason) await c.query("select set_config('app.reason', $1, true)", [reason]);
    const out = await fn(c);
    await c.query("commit");
    return out;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

export async function closePool() {
  await g.__ghamerPool?.end();
  g.__ghamerPool = undefined;
}
