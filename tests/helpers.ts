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
  // tests compute "this month" with the JS UTC clock; set TEST_TZ=UTC to avoid false failures in the hours around midnight when the company timezone is already on the next day
  if (process.env.TEST_TZ) await admin.query("insert into settings(key, value) values ('timezone', to_jsonb($1::text)) on conflict (key) do update set value = excluded.value", [process.env.TEST_TZ]);
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

/** Tele Sales registers an Interested lead, sends it to a Sales person, who accepts it. Returns the lead id. */
export async function sendAccepted(tele: string, sales: string, payload: any) {
  const r = await register(tele, payload);
  await run(tele, "select app.handoff_lead($1,$2,'ملاحظة')", [r.lead_id, ids[sales]]);
  await run(sales, "select app.accept_handoff($1)", [r.lead_id]);
  return r.lead_id as string;
}
/** Sales books an online meeting for an accepted lead. */
export async function bookAs(sales: string, lead: string, minutes = 120, url: string | null = null, request: string | null = null) {
  const r = await run(sales, "select app.book_meeting($1,$2,'اجتماع','online',$3,null,$4) id", [lead, future(minutes), url, request]);
  return r.rows[0].id as string;
}
export const pastMeeting = (id: string) => admin.query("update meetings set scheduled_at = now() - interval '1 hour' where id = $1", [id]);

/** A minimal real PDF header — enough for the server's content check. */
export const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n");
export const contractPayload = (o: { amount?: number; installments?: { kind?: string; due_date: string; amount: number }[]; discount?: number; start?: string; months?: number } = {}) => ({
  package: "monthly", duration_months: o.months ?? 3, start_date: o.start ?? "2027-01-01", payment_method: "bank_transfer", discount: o.discount ?? 0,
  items: [{ service: "social_media", description: "إدارة حسابات", amount: o.amount ?? 11500 }], installments: o.installments ?? [],
});
/** Sales writes the contract of a deal, uploads the signed file and sends it to Finance (the only way to reach «تم الاتفاق / التوقيع»). Returns the contract id. */
export async function signContract(sales: string, deal: string, payload: any = contractPayload()) {
  const id = (await run(sales, "select app.contract_save($1,$2::jsonb) id", [deal, JSON.stringify(payload)])).rows[0].id as string;
  await run(sales, "select app.contract_attach($1,'signed_contract','عقد موقع.pdf','application/pdf',$2)", [id, PDF]);
  await run(sales, "select app.contract_submit($1)", [id]);
  return id;
}
