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

let roleVerified = false;
/** Fail closed: if the app connects with a role that bypasses Row Level Security (postgres, service_role…), refuse to run. */
async function assertRestrictedRole(c: PoolClient) {
  if (roleVerified) return;
  const r = await c.query("select (rolsuper or rolbypassrls) as bad, current_user as who from pg_roles where rolname = current_user");
  if (r.rows[0]?.bad) {
    throw new Error(`UNSAFE_DB_ROLE: DATABASE_URL connects as "${r.rows[0].who}" which bypasses Row Level Security. Use the restricted role ghamer_app.`);
  }
  roleVerified = true;
}

export async function tx<T>(userId: string | null, fn: (c: PoolClient) => Promise<T>, reason?: string): Promise<T> {
  const c = await getPool().connect();
  try {
    // one round trip: BEGIN + user context (userId is always a UUID from our own database, validated here)
    if (userId && !/^[0-9a-f-]{36}$/i.test(userId)) throw new Error("invalid user id");
    await c.query(userId ? `begin; select set_config('app.user_id', '${userId}', true)` : "begin");
    await assertRestrictedRole(c);
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
