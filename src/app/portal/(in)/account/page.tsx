import { requirePortal } from "@/lib/portal-auth";
import { portalProfile } from "@/server/portal-data";
import { fmtDateTime } from "@/lib/format";
import { ActionForm, Field } from "@/components/forms";
import { portalLogoutAction, portalPasswordAction } from "@/server/portal-actions";
import { PageTitle, Panel } from "@/components/portal/ui";

export const metadata = { title: "حسابي" };

export default async function PortalAccount() {
  const ps = await requirePortal();
  const p = await portalProfile(ps.accountId);
  return (
    <>
      <PageTitle title="حسابي" />
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="بياناتك">
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between gap-3"><dt className="text-ink-500">الاسم</dt><dd className="font-semibold">{p.client_name}</dd></div>
            {p.contact_name !== p.client_name && <div className="flex justify-between gap-3"><dt className="text-ink-500">صاحب الحساب</dt><dd className="font-semibold">{p.contact_name}</dd></div>}
            <div className="flex justify-between gap-3"><dt className="text-ink-500">رقم الدخول</dt><dd className="font-semibold" dir="ltr">{p.phone}</dd></div>
            {p.account_manager && <div className="flex justify-between gap-3"><dt className="text-ink-500">مدير حسابك</dt><dd className="font-semibold">{p.account_manager}</dd></div>}
            <div className="flex justify-between gap-3"><dt className="text-ink-500">آخر دخول</dt><dd>{fmtDateTime(p.last_login_at)}</dd></div>
          </dl>
          <p className="mt-4 text-xs leading-6 text-ink-500">عاوز تغير رقم الدخول أو بيانات الشركة؟ ابعت طلب دعم ومدير حسابك هيظبطها.</p>
          <form action={portalLogoutAction} className="mt-4"><button className="rounded-xl border border-line px-4 py-2 text-sm font-medium hover:bg-cream">تسجيل الخروج</button></form>
        </Panel>
        <Panel title="تغيير كلمة المرور">
          <ActionForm action={portalPasswordAction} submit="حفظ">
            <Field label="كلمة المرور الحالية" name="current" type="password" dir="ltr" required />
            <Field label="كلمة المرور الجديدة" name="password" type="password" dir="ltr" required hint="10 حروف على الأقل، فيها حروف وأرقام." />
            <Field label="اكتبها تاني" name="confirm" type="password" dir="ltr" required />
          </ActionForm>
        </Panel>
      </div>
    </>
  );
}
