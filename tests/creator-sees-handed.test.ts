import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupDb, teardown, run, register, leadPayload, ids } from "./helpers";

beforeAll(async () => { await setupDb("ghamer_handed_test"); });
afterAll(async () => { await teardown(); });

const list = (who: string) => run(who, "select * from app.list_leads(null,null,null,null,null,null,null,'created','desc',100,0,null)").then((r) => r.rows);

describe("Tele keeps seeing a lead after handing it to Sales", () => {
  it("stays in the creator's list (read only) and is still hidden from other Teles", async () => {
    const lead = (await register("tele1", leadPayload({ name: "محوّل", phone: "0558880001", status: "Interested" }))).lead_id;
    await run("tele1", "select app.handoff_lead($1,$2,'ملاحظة')", [lead, ids.sales1]);
    const mine = (await list("tele1")).find((r: any) => r.id === lead);
    expect(mine).toBeTruthy(); expect(mine.handed_off_at).not.toBeNull();
    expect((await list("tele2")).some((r: any) => r.id === lead)).toBe(false);
    expect((await list("sales1")).some((r: any) => r.id === lead)).toBe(true);
    expect((await run("tele1", "select app.lead_visible($1) v", [lead])).rows[0].v).toBe(true);
    expect((await run("tele2", "select app.lead_visible($1) v", [lead])).rows[0].v).toBe(false);
    // still cannot change it
    await expect(run("tele1", "update leads set call_notes='x' where id=$1 returning id", [lead]).then((r) => { if (r.rowCount === 0) throw new Error("no rows"); })).rejects.toThrow();
    const out = (await run("tele1", "select * from app.my_lead_outcomes()")).rows;
    expect(out.some((o: any) => o.lead_id === lead)).toBe(true);
  });
});
