import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupDb, teardown, run, register, leadPayload, ids } from "./helpers";

beforeAll(async () => { await setupDb("ghamer_marks_test"); });
afterAll(async () => { await teardown(); });

const list = (who: string, sort = "created") =>
  run(who, "select * from app.list_leads(null,null,null,null,null,null,null,$1,'asc',100,0,null)", [sort]).then((r) => r.rows);

describe("per-user order and cell colours", () => {
  let a: string, b: string, c: string, other: string;
  it("setup", async () => {
    a = (await register("tele1", leadPayload({ name: "أ", phone: "0556660001" }))).lead_id;
    b = (await register("tele1", leadPayload({ name: "ب", phone: "0556660002" }))).lead_id;
    c = (await register("tele1", leadPayload({ name: "ج", phone: "0556660003" }))).lead_id;
    other = (await register("tele2", leadPayload({ name: "د", phone: "0556660004" }))).lead_id;
    expect((await run("tele1", "select app.has_manual_order() v")).rows[0].v).toBe(false);
  });
  it("manual order is saved per user and used by sort=manual", async () => {
    expect((await run("tele1", "select app.reorder_leads($1::uuid[]) n", [[c, a, b]])).rows[0].n).toBe(3);
    expect((await list("tele1", "manual")).map((r) => r.id)).toEqual([c, a, b]);
    expect((await run("tele1", "select app.has_manual_order() v")).rows[0].v).toBe(true);
    expect((await run("tele2", "select app.has_manual_order() v")).rows[0].v).toBe(false);
  });
  it("cannot order or colour someone else's lead", async () => {
    const n = (await run("tele1", "select app.reorder_leads($1::uuid[]) n", [[other, b]])).rows[0].n;
    expect(n).toBe(1);
    await expect(run("tele1", "select app.mark_cells($1,$2::text[],'red')", [other, ["name"]])).rejects.toThrow();
  });
  it("colours: set, overwrite, clear; invalid rejected; private to the user", async () => {
    await run("tele1", "select app.mark_cells($1,$2::text[],'red')", [a, ["name", "phone"]]);
    let row = (await list("tele1")).find((r) => r.id === a);
    expect(row.colors).toEqual({ name: "red", phone: "red" });
    await run("tele1", "select app.mark_cells($1,$2::text[],'blue')", [a, ["name"]]);
    row = (await list("tele1")).find((r) => r.id === a);
    expect(row.colors).toEqual({ name: "blue", phone: "red" });
    await run("tele1", "select app.mark_cells($1,$2::text[],null)", [a, ["phone"]]);
    row = (await list("tele1")).find((r) => r.id === a);
    expect(row.colors).toEqual({ name: "blue" });
    await expect(run("tele1", "select app.mark_cells($1,$2::text[],'<script>')", [a, ["name"]])).rejects.toThrow();
    await expect(run("tele1", "select app.mark_cells($1,$2::text[],'red')", [a, ["bogus"]])).rejects.toThrow();
    // manager sees the same lead without tele1's colours
    const m = (await list("telemgr")).find((r) => r.id === a);
    expect(m.colors).toEqual({});
  });
  it("reset removes only my order; tables are closed to the app role", async () => {
    await run("tele1", "select app.reset_lead_order()");
    expect((await run("tele1", "select app.has_manual_order() v")).rows[0].v).toBe(false);
    await expect(run("tele1", "select * from lead_marks")).rejects.toThrow(/permission denied/);
  });
});

describe("partial reorder keeps earlier places after the new ones", () => {
  it("unloaded leads with a saved place stay after the arranged ones, in their old relative order", async () => {
    const ids3: string[] = [];
    for (let i = 0; i < 3; i++) ids3.push((await register("sales1", leadPayload({ name: "ر" + i, phone: "055777000" + i }))).lead_id);
    await run("sales1", "select app.reorder_leads($1::uuid[])", [[ids3[0], ids3[1], ids3[2]]]);
    await run("sales1", "select app.reorder_leads($1::uuid[])", [[ids3[2]]]);
    const r = await run("sales1", "select * from app.list_leads(null,null,null,null,null,null,null,'manual','asc',100,0,null)");
    expect(r.rows.map((x: any) => x.id)).toEqual([ids3[2], ids3[0], ids3[1]]);
  });
});

describe("new leads appear on top while 'my order' is active", () => {
  it("a lead added after arranging comes first, then the arranged ones", async () => {
    const x = (await register("sales2", leadPayload({ name: "س1", phone: "0559990001" }))).lead_id;
    const y = (await register("sales2", leadPayload({ name: "س2", phone: "0559990002" }))).lead_id;
    await run("sales2", "select app.reorder_leads($1::uuid[])", [[y, x]]);
    const n = (await register("sales2", leadPayload({ name: "جديد", phone: "0559990003" }))).lead_id;
    const r = await run("sales2", "select * from app.list_leads(null,null,null,null,null,null,null,'manual','asc',100,0,null)");
    expect(r.rows.map((z: any) => z.id).slice(0, 3)).toEqual([n, y, x]);
  });
});
