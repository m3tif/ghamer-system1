import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { loginAction } from "@/server/actions";
import { ActionForm, Field } from "@/components/forms";

export const metadata = { title: "تسجيل الدخول" };

export default async function LoginPage() {
  if (await getSession()) redirect("/");
  return (
    <main className="grid min-h-screen md:grid-cols-[1fr_minmax(380px,460px)]">
      <section className="hidden bg-burgundy-600 p-12 text-white md:flex md:flex-col md:justify-between">
        <div className="text-3xl font-extrabold">غامر</div>
        <div>
          <p className="max-w-md text-4xl font-extrabold leading-snug">من أول مكالمة إلى تجديد العقد، كل شيء في مكان واحد.</p>
          <p className="mt-4 max-w-md text-burgundy-100">Ghamer CRM — نظام إدارة العملاء والمبيعات والتشغيل.</p>
        </div>
        <div className="text-sm text-burgundy-200">Ghamer Agency</div>
      </section>
      <section className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <h1 className="mb-1 text-2xl font-extrabold">تسجيل الدخول</h1>
          <p className="mb-6 text-sm text-ink-500">استخدم الحساب الذي أنشأته لك الإدارة.</p>
          <ActionForm action={loginAction} submit="دخول">
            <Field label="البريد الإلكتروني" name="email" type="email" dir="ltr" required />
            <Field label="كلمة المرور" name="password" type="password" dir="ltr" required />
          </ActionForm>
        </div>
      </section>
    </main>
  );
}
