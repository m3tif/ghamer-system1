import { requireSession } from "@/lib/auth";
import { changePasswordAction } from "@/server/actions";
import { ActionForm, Field } from "@/components/forms";
import Link from "next/link";

export const metadata = { title: "حسابي" };

export default async function AccountPage() {
  const s = await requireSession({ allowPasswordChange: true });
  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="text-2xl font-extrabold">{s.mustChangePassword ? "غيّر كلمة المرور للمتابعة" : "تغيير كلمة المرور"}</h1>
      <p className="mb-6 mt-1 text-sm text-ink-500">{s.fullName} · {s.roleNameAr}</p>
      <div className="rounded-lg border border-line bg-white p-5">
        <ActionForm action={changePasswordAction} submit="حفظ كلمة المرور الجديدة">
          <Field label="كلمة المرور الحالية" name="old" type="password" dir="ltr" required />
          <Field label="كلمة المرور الجديدة" name="new" type="password" dir="ltr" required hint="10 أحرف على الأقل، وتحتوي على حروف وأرقام" />
          <Field label="تأكيد كلمة المرور" name="confirm" type="password" dir="ltr" required />
        </ActionForm>
      </div>
      {!s.mustChangePassword && <p className="mt-4 text-sm"><Link href="/" className="text-burgundy-600 underline">العودة للوحة التحكم</Link></p>}
    </main>
  );
}
