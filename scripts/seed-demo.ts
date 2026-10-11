/* Demo data for local/staging. Refuses to run in production unless ALLOW_DEMO_SEED=1.
   Everything goes through the same SQL functions the app uses (so RLS and audit are exercised). */
import { Client } from "pg";
import { hash } from "@node-rs/argon2";
import { normalizePhone, normalizeStoreUrl } from "../src/lib/normalize";

const url = process.env.DATABASE_URL_ADMIN;
if (!url) { console.error("DATABASE_URL_ADMIN is required"); process.exit(1); }
if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_SEED !== "1") { console.error("Refusing to seed demo data in production"); process.exit(1); }
const PASSWORD = process.env.DEMO_PASSWORD ?? "Ghamer-Demo-2026";

const c = new Client({ connectionString: url });
const ids: Record<string, string> = {};

async function user(key: string, role: string, name: string, manager?: string) {
  const h = await hash(PASSWORD, { memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32 });
  const u = await c.query("insert into users(email, password_hash, role_id) select $1,$2,id from roles where code=$3 returning id", [`${key}@ghamer.demo`, h, role]);
  ids[key] = u.rows[0].id;
  await c.query("insert into employees(id, full_name, department_id, job_title) select $1,$2,department_id,name_ar from roles where code=$3", [ids[key], name, role]);
  if (manager) await c.query("insert into team_memberships(manager_id, member_id) values ($1,$2)", [ids[manager], ids[key]]);
}
async function as<T>(key: string, fn: () => Promise<T>): Promise<T> {
  await c.query("begin"); await c.query("set local role ghamer_app"); await c.query("select set_config('app.user_id',$1,true)", [ids[key]]);
  try { const r = await fn(); await c.query("commit"); return r; } catch (e) { await c.query("rollback"); throw e; }
}
const payload = (name: string, phone: string, store?: string, extra: any = {}) => {
  const identifiers: any[] = [{ kind: "phone", value: normalizePhone(phone)!, label: "mobile" }], stores: any[] = [];
  if (store) { const s = normalizeStoreUrl(store)!; identifiers.push({ kind: "store", value: s.key, label: "store" }); stores.push({ url_raw: s.raw, url_key: s.key }); }
  return { name, source: "cold_call", lead_status: "Interested", required_services: ["social_media", "paid_ads"], identifiers, stores,
           contacts: [{ label: "mobile", phone: normalizePhone(phone), is_primary: true }], city: "الرياض", ...extra };
};
const reg = async (who: string, p: any) => as(who, async () => (await c.query("select app.register_lead($1::jsonb) r", [JSON.stringify(p)])).rows[0].r);
const iso = (h: number) => new Date(Date.now() + h * 3600000).toISOString();

(async () => {
  await c.connect();
  const exists = await c.query("select 1 from users where email like '%@ghamer.demo' limit 1");
  if (exists.rowCount) { console.log("Demo data already present."); await c.end(); return; }
  await c.query("begin");
  await user("admin", "super_admin", "مدير النظام (تجريبي)");
  await user("gm", "general_manager", "نورة العتيبي — المدير العام");
  await user("telemgr", "tele_sales_manager", "لمى الحربي — مديرة التيلي سيلز");
  await user("tele1", "tele_sales", "سارة القحطاني", "telemgr");
  await user("tele2", "tele_sales", "ريم الدوسري", "telemgr");
  await user("salesmgr", "sales_manager", "عمر الشهري — مدير المبيعات");
  await user("sales1", "sales_rep", "خالد المطيري", "salesmgr");
  await user("sales2", "sales_rep", "فهد الغامدي", "salesmgr");
  await user("finmgr", "finance_manager", "هند السبيعي — مديرة المالية");
  await user("ops", "operations_manager", "ماجد العنزي — مدير العمليات");
  await user("am1", "account_manager", "دانة الزهراني");
  await user("tech1", "technical_employee", "يوسف الشمري — مصمم");
  await c.query("commit");

  const mk = (n: number) => `05${String(5000000 + n * 137).padStart(8, "0")}`;
  const L: Record<string, string> = {};
  const names = ["متجر الورد الراقي", "عطور الليل", "مخبز السنابل", "أزياء نجد", "مركز الأفق للتدريب", "قهوة الديرة", "لمسة جمال", "بيت الأثاث", "مزاج للحلويات", "ركن الإلكترونيات"];
  for (let i = 0; i < names.length; i++) {
    const who = i % 2 === 0 ? "tele1" : "tele2";
    const r = await reg(who, payload(names[i], mk(i + 1), `https://www.${["rose", "oud", "sanabel", "najd", "ofoq", "dirah", "lamsa", "furn", "mazaj", "elec"][i]}-store.com.sa/?utm_source=ig`,
      { lead_status: ["Interested", "Call Back", "Not Answered", "Interested", "Follow-up Later", "Interested", "Not Interested", "Interested", "New", "Interested"][i],
        source: ["cold_call", "meta_ads", "website", "referral", "cold_call", "whatsapp", "social", "meta_ads", "cold_call", "referral"][i],
        next_followup_at: i % 3 === 1 ? iso(-5) : null, followup_reason: "اتصال متابعة", call_notes: "تم الاتصال وشرح الخدمات" }));
    L[names[i]] = r.lead_id;
  }
  // meetings: future ones + past ones (back-dated by admin to simulate held meetings)
  const book = async (who: string, lead: string, rep: string, h: number) => as(who, async () => (await c.query("select app.book_meeting($1,$2,$3,'https://meet.google.com/demo-room','تم الاتفاق على موعد') id", [lead, ids[rep], iso(h)])).rows[0].id);
  const done = await book("tele1", L[names[0]], "sales1", 2);
  const done2 = await book("tele2", L[names[3]], "sales2", 3);
  const done3 = await book("tele1", L[names[2]], "sales1", 4);
  await book("tele2", L[names[7]], "sales1", 48);
  await book("tele2", L[names[5]], "sales2", 26);
  const cancelled = await book("tele2", L[names[9]], "sales2", 30);
  for (const id of [done, done2, done3]) await c.query("update meetings set scheduled_at = now() - interval '2 hours' where id = $1", [id]);
  await as("sales1", () => c.query("select app.set_meeting_status($1,'complete',null,null,null)", [done]));
  await as("sales2", () => c.query("select app.set_meeting_status($1,'complete',null,null,null)", [done2]));
  await as("sales1", () => c.query("select app.set_meeting_status($1,'complete',null,null,null)", [done3]));
  await as("tele2", () => c.query("select app.set_meeting_status($1,'cancel','العميل اعتذر عن الموعد',null,null)", [cancelled]));
  // deal progress
  const dealOf = async (lead: string) => (await c.query("select id from deals where lead_id = $1", [lead])).rows[0].id;
  const d1 = await dealOf(L[names[0]]), d2 = await dealOf(L[names[3]]), d3 = await dealOf(L[names[5]]);
  await as("sales1", async () => {
    await c.query("update deals set expected_value = 36000, win_probability = 70 where id = $1", [d1]);
    await c.query("select app.move_deal_stage($1,'Proposal Sent','تم إرسال عرض السعر',null,null)", [d1]);
  });
  await as("sales2", async () => {
    await c.query("update deals set expected_value = 24000, win_probability = 40 where id = $1", [d3]);
    await c.query("select app.move_deal_stage($1,'Postponed',null,$2,'العميل يريد مراجعة الميزانية مع الشريك')", [d3, iso(72)]);
    await c.query("update deals set expected_value = 60000, win_probability = 90 where id = $1", [d2]);
    await c.query("select app.move_deal_stage($1,'Signed / Finance Pending','تم توقيع العقد',null,null)", [d2]);
  });
  // a direct sales lead, a duplicate attempt and an ownership-review request
  await reg("sales2", payload("شركة البناء الحديث", mk(40), "https://modern-build.com", { source: "referral", lead_status: "New" }));
  const dup = await reg("tele2", payload("نفس متجر الورد", mk(1)));
  if (dup.status === "duplicate") await as("tele2", () => c.query("select app.request_ownership_review($1,$2,'{}')", [dup.existing_client_id, "تواصلت مع صاحب المتجر قبل أسبوع عبر واتساب"]));
  // targets for the current month
  const month = new Date().toISOString().slice(0, 7) + "-01";
  await as("telemgr", async () => { for (const k of ["tele1", "tele2"]) await c.query("insert into targets(employee_id, period_month, metric, target_value, set_by) values ($1,$2,'completed_meetings',12,$3)", [ids[k], month, ids.telemgr]); });
  await as("salesmgr", async () => { for (const k of ["sales1", "sales2"]) await c.query("insert into targets(employee_id, period_month, metric, target_value, set_by) values ($1,$2,'deals_won',4,$3)", [ids[k], month, ids.salesmgr]); });
  console.log("✓ Demo data created. Sign in with any of:\n  tele1@ghamer.demo  tele2@ghamer.demo  sales1@ghamer.demo  sales2@ghamer.demo\n  telemgr@ghamer.demo salesmgr@ghamer.demo gm@ghamer.demo admin@ghamer.demo (these need two-factor setup)\n  password:", PASSWORD);
  await c.end();
})().catch(async (e) => { console.error(e); await c.query("rollback").catch(() => {}); await c.end(); process.exit(1); });
