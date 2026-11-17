import { Dialog } from "@/components/dialog";
import { ActionForm, Field, Hidden, TextArea } from "@/components/forms";
import { PhoneField } from "@/components/phone-field";
import { opsClientUpdateAction } from "@/server/actions";
import { opsClientGet } from "@/server/data";

const Lbl = ({ children, req }: { children: string; req?: boolean }) => <span className="mb-1 block text-sm font-medium">{children}{req && <span className="text-burgundy-600"> *</span>}</span>;

/** «تعديل بيانات العميل»: name, business, contact person, city, phones and store links. Shows only to who may edit. */
export async function OpsClientEdit({ uid, opsId, label = "✎ تعديل بيانات العميل" }: { uid: string; opsId: string; label?: string }) {
  const c = await opsClientGet(uid, opsId);
  if (!c) return null;
  return (
    <Dialog trigger={label} title={`تعديل بيانات العميل — ${c.name}`} tone="quiet">
      <ActionForm action={opsClientUpdateAction} submit="حفظ" className="grid gap-4 sm:grid-cols-2">
        <Hidden name="ops_id" value={opsId} />
        <Field label="اسم العميل" name="name" required defaultValue={c.name === "بدون اسم" ? "" : c.name} />
        <Field label="اسم النشاط / المتجر" name="business_name" defaultValue={c.business_name ?? ""} />
        <label className="block"><Lbl req>رقم الجوال</Lbl><PhoneField name="phone" required defaultValue={c.phone ?? ""} /></label>
        <label className="block"><Lbl>رقم تاني (اختياري)</Lbl><PhoneField name="alt_phone" defaultValue={c.alt_phone ?? ""} /></label>
        <label className="block"><Lbl>واتساب (لو مختلف)</Lbl><PhoneField name="whatsapp" defaultValue={c.whatsapp ?? ""} /></label>
        <Field label="الشخص المسؤول" name="contact_person" defaultValue={c.contact_person ?? ""} />
        <Field label="المدينة" name="city" defaultValue={c.city ?? ""} />
        <div className="sm:col-span-2"><TextArea label="رابط المتجر / الموقع (كل رابط في سطر)" name="store_url" rows={2} defaultValue={(c.stores ?? []).join("\n")} /></div>
        <p className="text-xs text-ink-500 sm:col-span-2">لو الرقم أو الرابط متسجل على عميل تاني، مش هيتحفظ وهيقولك هو عند مين.</p>
      </ActionForm>
    </Dialog>
  );
}
