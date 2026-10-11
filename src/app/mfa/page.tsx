import Image from "next/image";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { getSession } from "@/lib/auth";
import { mfaAction, mfaEnroll, logoutAction } from "@/server/actions";
import { ActionForm, Field } from "@/components/forms";

export const metadata = { title: "التحقق بخطوتين" };

export default async function MfaPage() {
  const s = await getSession();
  if (!s) redirect("/login");
  if (s.mfaVerified || (!s.mfaRequired && !s.mfaEnabled)) redirect("/");
  const enroll = s.mfaEnabled ? null : await mfaEnroll();
  const qr = enroll ? await QRCode.toDataURL(enroll.uri, { margin: 1, width: 220 }) : null;
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-xl border border-line bg-white p-6">
        <h1 className="text-xl font-extrabold">التحقق بخطوتين</h1>
        {enroll ? (
          <>
            <p className="mt-2 text-sm text-ink-500">حسابك يتطلب تفعيل التحقق بخطوتين. امسح الرمز بتطبيق مصادقة (Google Authenticator أو Microsoft Authenticator) ثم أدخل الرمز المكوّن من 6 أرقام.</p>
            {qr && <Image src={qr} alt="رمز QR لتفعيل المصادقة" width={220} height={220} unoptimized className="mx-auto my-4 rounded-md border border-line" />}
            <p className="mb-4 break-all text-center text-xs text-ink-500" dir="ltr">{enroll.base32}</p>
          </>
        ) : (
          <p className="mt-2 mb-4 text-sm text-ink-500">أدخل الرمز الحالي من تطبيق المصادقة.</p>
        )}
        <ActionForm action={mfaAction} submit="تأكيد">
          <Field label="رمز التحقق" name="code" dir="ltr" required placeholder="123456" />
        </ActionForm>
        <form action={logoutAction} className="mt-4 text-center"><button className="text-sm text-ink-500 underline">تسجيل الخروج</button></form>
      </div>
    </main>
  );
}
