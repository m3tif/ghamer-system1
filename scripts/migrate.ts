/* Runs db/migrations/*.sql in order, once each. Uses the ADMIN connection (owner role). */
import { Client } from "pg";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export async function migrate(adminUrl: string, appPassword?: string) {
  const c = new Client({ connectionString: adminUrl });
  await c.connect();
  try {
    await c.query(`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`);
    const dir = join(process.cwd(), "db", "migrations");
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    for (const f of files) {
      const done = await c.query("select 1 from schema_migrations where name = $1", [f]);
      if (done.rowCount) continue;
      console.log("→ applying", f);
      await c.query("begin");
      try {
        await c.query(readFileSync(join(dir, f), "utf8"));
        await c.query("insert into schema_migrations(name) values ($1)", [f]);
        await c.query("commit");
      } catch (e) {
        await c.query("rollback");
        throw new Error(`Migration ${f} failed: ${(e as Error).message}`);
      }
    }
    if (appPassword) {
      const lit = (await c.query("select quote_literal($1) as q", [appPassword])).rows[0].q;
      await c.query(`alter role ghamer_app with password ${lit}`);
      console.log("→ app role password set");
    }
    console.log("✓ migrations up to date");
  } finally {
    await c.end();
  }
}

if (process.argv[1]?.endsWith("migrate.ts")) {
  const url = process.env.DATABASE_URL_ADMIN;
  if (!url) { console.error("DATABASE_URL_ADMIN is required"); process.exit(1); }
  migrate(url, process.env.APP_DB_PASSWORD).catch((e) => { console.error(e.message); process.exit(1); });
}
