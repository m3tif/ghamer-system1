import { Client } from "pg";
import { migrate } from "../scripts/migrate";
import { normalizePhone, normalizeStoreUrl } from "../src/lib/normalize";

const BASE = process.env.TEST_PG_ADMIN ?? "postgres://postgres:postgres@localhost:5432";
export const APP_PW = "app_test_pw";
export const ids: Record<string, string> = {};
export let admin: Client;

export async function setupDb(dbName = "ghamer_test") {
  const root = new Client({ connectionString: `${BASE}/postgres` });
  await root.connect();
  await root.query(`drop database if exists ${dbName} with (force)`);
  await root.query(`create database ${dbName}`);
  await root.end();
  await migrate(`${BASE}/${dbName}`, APP_PW);
  admin = new Client({ connectionString: `${BASE}/${dbName}` });
  await admin.connect();
  process.env.DATABASE_URL = `postgres://ghamer_app:${APP_PW}@${new URL(BASE).host}/${dbName}`;

  const mk = async (key: string, role: string, name: string, manager?: string) => {
    const u = await admin.query(
      "insert into users(email, password_hash, role_id) select $1, 'x', id from roles where code = $2 returning id",
      [`${key}@test.local`, role]);
    ids[key] = u.rows[0].id;
    await admin.query("insert into employees(id, full_name, department_id) select $1, $2, department_id from roles where code = $3", [ids[key], name, role]);
    if (manager) await admin.query("insert into team_memberships(manager_id, member_id) values ($1, $2)", [ids[manager], ids[key]]);
  };
  await mk("super", "super_admin", "المدير النظام");
  await mk("gm", "general_manager", "المدير العام");
  await mk("telemgr", "tele_sales_manager", "مديرة التيلي");
  await mk("tele1", "tele_sales", "سارة", "telemgr");
  await mk("tele2", "tele_sales", "نورة", "telemgr");
  await mk("salesmgr", "sales_manager", "مدير المبيعات");
  await mk("sales1", "sales_rep", "خالد", "salesmgr");
  await mk("sales2", "sales_rep", "فهد", "salesmgr");
  await mk("fin", "finance_manager", "مدير المالية");
  await mk("tech", "technical_employee", "موظف تقني");
}

export async function teardown() { await admin?.end(); const { closePool } = await import("../src/lib/db"); await closePool(); }

export async function run(who: string, sql: string, params: unknown[] = []) {
  const { tx } = await import("../src/lib/db");
  return tx(ids[who], (c) => c.query(sql, params));
}

export function leadPayload(o: { name?: string; phone?: string; alt?: string; store?: string; status?: string; services?: string[] } = {}) {
  const identifiers: any[] = []; const contacts: any[] = []; const stores: any[] = [];
  for (const [label, v] of [["mobile", o.phone], ["alt_mobile", o.alt]] as const) {
    if (!v) continue;
    const n = normalizePhone(v)!;
    identifiers.push({ kind: "phone", value: n, label });
    contacts.push({ label, phone: n, is_primary: label === "mobile" });
  }
  if (o.store) {
    const s = normalizeStoreUrl(o.store)!;
    identifiers.push({ kind: "store", value: s.key, label: "store" });
    stores.push({ url_raw: s.raw, url_key: s.key });
  }
  return { name: o.name ?? "عميل تجريبي", source: "cold_call", lead_status: o.status ?? "New Lead",
           required_services: o.services ?? ["seo"], identifiers, contacts, stores };
}

export async function register(who: string, payload: any) {
  const r = await run(who, "select app.register_lead($1::jsonb) as r", [JSON.stringify(payload)]);
  return r.rows[0].r as any;
}
export const future = (mins = 120) => new Date(Date.now() + mins * 60000).toISOString();
