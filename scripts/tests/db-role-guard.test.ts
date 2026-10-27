import { it, expect, beforeAll } from "vitest";
import { Client } from "pg";

const BASE = process.env.TEST_PG_ADMIN ?? "postgres://postgres:postgres@localhost:5432";
beforeAll(async () => {
  // the restricted role exists cluster-wide after any migration run; give it a known password for this test
  const c = new Client({ connectionString: `${BASE}/ghamer_dev` }); await c.connect();
  await c.query("alter role ghamer_app with password 'guard_pw'"); await c.end();
});

it("refuses to run as a role that bypasses RLS (postgres / service_role)", async () => {
  process.env.DATABASE_URL = `${BASE}/ghamer_dev`;
  const { tx, closePool } = await import("../src/lib/db");
  await expect(tx(null, (c) => c.query("select 1"))).rejects.toThrow(/UNSAFE_DB_ROLE/);
  await closePool();
});
it("works with the restricted role", async () => {
  process.env.DATABASE_URL = `postgres://ghamer_app:guard_pw@${new URL(BASE).host}/ghamer_dev`;
  const { tx, closePool } = await import("../src/lib/db");
  expect((await tx(null, (c) => c.query("select 1 as x"))).rows[0].x).toBe(1);
  await closePool();
});
