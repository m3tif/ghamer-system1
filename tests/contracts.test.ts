import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupDb, teardown, run, ids, admin, leadPayload, sendAccepted, PDF, contractPayload, signContract } from "./helpers";

beforeAll(async () => { await setupDb("ghamer_contracts_test"); });
afterAll(async () => { await teardown(); });

const dealOf = async (lead: string) => (await admin.query("select id from deals where lead_id=$1", [lead])).rows[0].id as string;
const newDeal = async (tele: string, sales: string, phone: string) => dealOf(await sendAccepted(tele, sales, leadPayload({ name: "عميل عقد " + phone.slice(-3), phone, status: "Interested" })));
const save = (who: string, deal: string, p: any) => run(who, "select app.contract_save($1,$2::jsonb) id", [deal, JSON.stringify(p)]).then((r) => r.rows[0].id as string);
const get = (who: string, id: string) => run(who, "select app.contract_get($1) j", [id]).then((r) => r.rows[0].j);
const stage = (deal: string) => admin.query("select stage from deals where id=$1", [deal]).then((r) => r.rows[0].stage);

describe("contracts — Sales writes it, uploads the signed file, sends it to Finance", () => {
  let deal = "", id = "";
  it("only the deal's Sales rep (or his manager / the admin) can write the contract", async () => {
    deal = await newDeal("tele1", "sales1", "0571000001");
    await expect(save("sales2", deal, contractPayload())).rejects.toThrow(/no access/);
    await expect(save("tele1", deal, contractPayload())).rejects.toThrow(/no access/);
    await expect(save("fin", deal, contractPayload())).rejects.toThrow(/no access/);
    id = await save("sales1", deal, contractPayload({ amount: 11500 }));
    expect(await stage(deal)).toBe("Contract Pending");
  });
  it("prices are final: the VAT is taken from inside them; number, Tele credit and totals are stored", async () => {
    const c = (await get("sales1", id)).contract;
    expect(c.contract_no).toMatch(/^GH-\d{4}-0001$/);
    expect(Number(c.total_amount)).toBe(11500); expect(Number(c.net_amount)).toBe(10000); expect(Number(c.vat_amount)).toBe(1500);
    expect(Number(c.vat_rate)).toBe(0.15); expect(c.prices_include_vat).toBe(true);
    expect(c.sales_owner_id).toBe(ids.sales1); expect(c.tele_sales_id).toBe(ids.tele1);
    expect(c.start_date).toBe("2027-01-01"); expect(c.end_date).toBe("2027-03-31");     // 3 months
    expect(c.status).toBe("draft");
  });
  it("validation: services, prices, discount, dates, instalments", async () => {
    await expect(save("sales1", deal, { ...contractPayload(), items: [] })).rejects.toThrow(/at least one service/);
    await expect(save("sales1", deal, { ...contractPayload(), items: [{ service: "social_media", amount: 0 }] })).rejects.toThrow(/greater than zero/);
    await expect(save("sales1", deal, { ...contractPayload(), items: [{ service: "nope", amount: 5 }] })).rejects.toThrow(/invalid service/);
    await expect(save("sales1", deal, contractPayload({ amount: 1000, discount: 1000 }))).rejects.toThrow(/invalid discount/);
    await expect(save("sales1", deal, { ...contractPayload(), end_date: "2026-01-01" })).rejects.toThrow(/end date is before/);
    await expect(save("sales1", deal, contractPayload({ amount: 1000, installments: [{ due_date: "2027-01-01", amount: 400 }, { due_date: "2027-02-01", amount: 500 }] }))).rejects.toThrow(/add up/);
    // an edit replaces the lines, keeps the same contract and number
    const again = await save("sales1", deal, { ...contractPayload({ amount: 6900, discount: 0, installments: [{ kind: "down_payment", due_date: "2027-01-01", amount: 5000 }, { due_date: "2027-02-01", amount: 4600 }] }),
      items: [{ service: "social_media", amount: 6900 }, { service: "paid_ads", description: "إدارة إعلانات", amount: 2700 }] });
    expect(again).toBe(id);
    const j = await get("sales1", id);
    expect(j.items.length).toBe(2); expect(j.installments.length).toBe(2); expect(Number(j.contract.total_amount)).toBe(9600);
    expect((await admin.query("select count(*)::int n from contracts where deal_id=$1", [deal])).rows[0].n).toBe(1);
  });
  it("cannot be sent without the signed file; the file's real content decides its type; size is limited", async () => {
    await expect(run("sales1", "select app.contract_submit($1)", [id])).rejects.toThrow(/signed contract file required/);
    await expect(run("sales1", "select app.contract_attach($1,'signed_contract','x.pdf','application/pdf',$2)", [id, Buffer.from("<html>not a pdf</html>")])).rejects.toThrow(/unsupported file type/);
    await expect(run("sales1", "select app.contract_attach($1,'signed_contract','x.exe','application/x-msdownload',$2)", [id, PDF])).rejects.toThrow(/unsupported file type/);
    await expect(run("sales1", "select app.contract_attach($1,'signed_contract','big.pdf','application/pdf',$2)", [id, Buffer.concat([PDF, Buffer.alloc(4 * 1024 * 1024)])])).rejects.toThrow(/file too large/);
    await expect(run("sales2", "select app.contract_attach($1,'signed_contract','x.pdf','application/pdf',$2)", [id, PDF])).rejects.toThrow(/no access/);
    const f = (await run("sales1", "select app.contract_attach($1,'signed_contract','../../عقد موقع.pdf','application/pdf',$2) id", [id, PDF])).rows[0].id;
    const files = (await get("sales1", id)).files;
    expect(files.length).toBe(1); expect(files[0].filename).toBe("عقد موقع.pdf"); expect(files[0].kind).toBe("signed_contract");
    const got = (await run("sales1", "select * from app.attachment_get($1)", [f])).rows[0];
    expect(Buffer.compare(got.content, PDF)).toBe(0);
    expect((await run("sales2", "select * from app.attachment_get($1)", [f])).rowCount).toBe(0);
    expect((await run("tele1", "select * from app.attachment_get($1)", [f])).rowCount).toBe(0);
  });
  it("sending it: deal goes to «تم الاتفاق / التوقيع», Finance is told, pressing twice does nothing twice", async () => {
    await run("sales1", "select app.contract_submit($1)", [id]);
    await run("sales1", "select app.contract_submit($1)", [id]);
    expect(await stage(deal)).toBe("Signed / Finance Pending");
    const c = (await get("sales1", id)).contract;
    expect(c.status).toBe("submitted"); expect(c.submitted_by).toBe(ids.sales1); expect(c.agreed_at).toBeTruthy();
    expect((await admin.query("select count(*)::int n from deal_stage_history where deal_id=$1 and to_stage='Signed / Finance Pending'", [deal])).rows[0].n).toBe(1);
    expect((await admin.query("select closing_sales_id from deals where id=$1", [deal])).rows[0].closing_sales_id).toBe(ids.sales1);
    expect((await admin.query("select count(*)::int n from notifications where kind='contract_submitted' and user_id=$1", [ids.fin])).rows[0].n).toBe(1);
    // locked while it is with Finance
    await expect(save("sales1", deal, contractPayload())).rejects.toThrow(/locked/);
    await expect(run("sales1", "select app.contract_attach($1,'signed_contract','y.pdf','application/pdf',$2)", [id, PDF])).rejects.toThrow(/locked/);
    await expect(run("sales1", "select app.move_deal_stage($1,'Negotiation',null,null,null)", [deal])).rejects.toThrow(/locked/);
    await expect(run("sales1", "select app.move_deal_stage($1,'Lost','سبب',null,null)", [deal])).rejects.toThrow(/locked/);
  });
  it("who sees it: Sales owner, his manager, Finance, admin — not another Sales, not Tele; nobody writes the tables directly", async () => {
    for (const w of ["sales1", "salesmgr", "fin", "super", "gm"]) expect((await get(w, id))?.contract.id).toBe(id);
    for (const w of ["sales2", "tele1", "tele2", "tech"]) expect(await get(w, id)).toBeNull();
    expect((await run("sales2", "select count(*)::int n from contracts")).rows[0].n).toBe(0);
    expect((await run("fin", "select count(*)::int n from app.contract_list(null,null,50,0)")).rows[0].n).toBe(1);
    expect((await run("fin", "select count(*)::int n from app.contract_list('submitted','0571000001',50,0)")).rows[0].n).toBe(1);
    await expect(run("sales1", "update contracts set total_amount = 1 where id=$1", [id])).rejects.toThrow(/permission denied/);
    await expect(run("fin", "update contracts set status = 'approved' where id=$1", [id])).rejects.toThrow(/permission denied/);
    await expect(run("super", "delete from contracts where id=$1", [id])).rejects.toThrow(/permission denied/);
    await expect(run("sales1", "delete from attachments where entity_id=$1", [id])).rejects.toThrow(/permission denied/);
    await expect(run("sales1", "select * from attachment_blobs")).rejects.toThrow(/permission denied/);
  });
  it("Sales cannot approve money; Finance can send the contract back with a reason; Sales fixes and re-sends", async () => {
    await expect(run("sales1", "select app.move_deal_stage($1,'Financially Approved','x',null,null)", [deal])).rejects.toThrow(/Finance|locked/);
    await expect(run("sales1", "select app.contract_return($1,'x')", [id])).rejects.toThrow(/not allowed/);
    await expect(run("fin", "select app.contract_return($1,'')", [id])).rejects.toThrow(/reason required/);
    await run("fin", "select app.contract_return($1,'تاريخ البداية غلط')", [id]);
    expect(await stage(deal)).toBe("Contract Pending");
    const c = (await get("sales1", id)).contract;
    expect(c.status).toBe("returned"); expect(c.return_reason).toBe("تاريخ البداية غلط");
    expect((await admin.query("select count(*)::int n from notifications where kind='contract_returned' and user_id=$1", [ids.sales1])).rows[0].n).toBe(1);
    await save("sales1", deal, contractPayload({ amount: 9600, start: "2027-02-01" }));
    await run("sales1", "select app.contract_submit($1)", [id]);
    expect((await get("fin", id)).contract.status).toBe("submitted");
    expect((await get("fin", id)).installments.length).toBe(1);          // no schedule written → one payment on the start date
    expect(await stage(deal)).toBe("Signed / Finance Pending");
  });
  it("everything is in the audit log; numbers continue; a lost deal cancels its unsent contract (kept, not deleted)", async () => {
    const a = (await admin.query("select action, count(*)::int n from audit_logs where entity_type='contracts' and entity_id=$1 group by 1", [id])).rows;
    expect(a.find((x: any) => x.action === "INSERT").n).toBe(1); expect(a.find((x: any) => x.action === "UPDATE").n).toBeGreaterThanOrEqual(4);
    expect((await admin.query("select reason from audit_logs where entity_type='contracts' and entity_id=$1 and new_value->>'status'='returned'", [id])).rows[0].reason).toBe("تاريخ البداية غلط");
    const d2 = await newDeal("tele2", "sales2", "0571000002");
    const c2 = await save("sales2", d2, contractPayload());
    expect((await get("sales2", c2)).contract.contract_no).toMatch(/-0002$/);
    await run("sales2", "select app.move_deal_stage($1,'Lost','العميل اختار شركة تانية',null,null)", [d2]);
    expect((await admin.query("select status from contracts where id=$1", [c2])).rows[0].status).toBe("cancelled");
    await expect(save("sales2", d2, contractPayload())).rejects.toThrow(/deal is closed/);
    // two people saving the same deal at once still make one contract
    const d3 = await newDeal("tele2", "sales2", "0571000003");
    const r = await Promise.allSettled([1, 2, 3].map(() => save("sales2", d3, contractPayload())));
    expect(r.filter((x) => x.status === "fulfilled").length).toBe(3);
    expect((await admin.query("select count(*)::int n from contracts where deal_id=$1", [d3])).rows[0].n).toBe(1);
    expect(await signContract("sales2", d3)).toBeTruthy();
  });
});
