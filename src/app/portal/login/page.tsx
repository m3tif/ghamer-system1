import { redirect } from "next/navigation";
import { getPortalSession } from "@/lib/portal-auth";
import { portalLoginAction } from "@/server/portal-actions";
import { ActionForm, Field } from "@/components/forms";

export const metadata = { title: "دخول بوابة العملاء" };
export const dynamic = "force-dynamic";

export default async function PortalLogin() {
  if (await getPortalSession()) redirect("/portal");
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#faf7f2] p-5">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-burgundy-600 text-2xl font-extrabold text-white">غ</span>
          <h1 className="text-2xl font-extrabold">بوابة عملاء غامر</h1>
          <p className="mt-2 text-sm leading-7 text-ink-500">تابع مشروعك خطوة بخطوة: المراحل، آخر التحديثات، المطلوب منك، والموافقات.</p>
        </div>
        <div className="rounded-2xl border border-line/70 bg-white p-6 shadow-sm sm:p-8">
          <ActionForm action={portalLoginAction} submit="دخول">
            <Field label="رقم الجوال" name="phone" type="tel" dir="ltr" placeholder="05xxxxxxxx" required />
            <Field label="كلمة المرور" name="password" type="password" dir="ltr" required />
          </ActionForm>
          <p className="mt-5 text-xs leading-6 text-ink-500">مدير حسابك هو اللي بيبعتلك بيانات الدخول أول مرة. نسيت كلمة المرور؟ كلّمه وهيبعتلك كلمة مؤقتة جديدة.</p>
        </div>
      </div>
    </main>
  );
}
