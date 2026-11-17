import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupDb, teardown, run, ids, admin } from "./helpers";

beforeAll(async () => { await setupDb("ghamer_reports_test"); });
afterAll(async () => { await teardown(); });

const list = (who: string, emp: string | null = null) => run(who, "select * from app.daily_report_list(null,null,$1)", [emp]).then((r) => r.rows);

describe("daily report — technical team, optional, one per day", () => {
  it("a technical employee writes today's report and can rewrite it the same day (one row)", async () => {
    await run("designer", "select app.daily_report_save('خلصت البانرات','figma.com/x')");
    await run("designer", "select app.daily_report_save('خلصت البانرات + الستوري',null)");
    const r = await list("designer");
    expect(r.length).toBe(1); expect(r[0].body).toBe("خلصت البانرات + الستوري"); expect(r[0].links).toBeNull();
    await expect(run("designer", "select app.daily_report_save('   ',null)")).rejects.toThrow(/report text required/);
    expect((await admin.query("select count(*)::int n from audit_logs where entity_type='daily_reports'")).rows[0].n).toBeGreaterThanOrEqual(2);
  });
  it("sales / tele / finance can't write one", async () => {
    for (const who of ["sales1", "tele1", "fin"]) await expect(run(who, "select app.daily_report_save('x',null)")).rejects.toThrow(/not allowed/);
  });
  it("each person sees only his own; the Technical Manager and the admin see everyone", async () => {
    await run("am1", "select app.daily_report_save('كلمت 3 عملاء',null)");
    expect((await list("am1")).map((r: any) => r.body)).toEqual(["كلمت 3 عملاء"]);
    expect((await list("designer")).length).toBe(1);
    expect((await list("techmgr")).length).toBe(2);
    expect((await list("super")).length).toBe(2);
    expect((await list("techmgr", ids.am1)).length).toBe(1);
    expect((await list("designer", ids.am1)).map((r: any) => r.employee_id)).toEqual([ids.designer]);   // filter ignored → still only his own
    const team = (await run("techmgr", "select * from app.daily_report_team(null)")).rows;
    expect(team.find((t: any) => t.employee_id === ids.designer).sent).toBe(true);
    expect(team.some((t: any) => t.employee_id === ids.sales1)).toBe(false);
    expect((await run("am1", "select * from app.daily_report_team(null)")).rows.length).toBe(0);
  });
});
