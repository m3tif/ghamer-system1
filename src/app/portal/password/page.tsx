import { requirePortal } from "@/lib/portal-auth";
import { portalPasswordAction, portalLogoutAction } from "@/server/portal-actions";
import { ActionForm, Field } from "@/components/forms";

export const metadata = { title: "اختار كلمة المرور" };
export const dynamic = "force-dynamic";

/** First sign-in (or after a reset): the client replaces the temporary password with his own. */
export default async function PortalPassword() {
  const ps = await requirePortal({ allowPasswordChange: true });
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#faf7f2] p-5">
      <div className="w-full max-w-md rounded-2xl border border-line/70 bg-white p-6 shadow-sm sm:p-8">
        <h1 className="text-xl font-extrabold">أهلًا {ps.clientName} 👋</h1>
        <p className="mb-6 mt-2 text-sm leading-7 text-ink-500">{ps.mustChangePassword ? "قبل ما تبدأ، اختار كلمة مرور خاصة بيك بدل الكلمة المؤقتة." : "غيّر كلمة المرور."}</p>
        <ActionForm action={portalPasswordAction} submit="حفظ والدخول">
          <Field label={ps.mustChangePassword ? "كلمة المرور المؤقتة" : "كلمة المرور الحالية"} name="current" type="password" dir="ltr" required />
          <Field label="كلمة المرور الجديدة" name="password" type="password" dir="ltr" required hint="10 حروف على الأقل، فيها حروف وأرقام." />
          <Field label="اكتبها تاني" name="confirm" type="password" dir="ltr" required />
        </ActionForm>
        <form action={portalLogoutAction} className="mt-4"><button className="text-sm text-ink-500 underline">خروج</button></form>
      </div>
    </main>
  );
}
