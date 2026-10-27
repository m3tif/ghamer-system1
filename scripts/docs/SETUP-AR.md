# دليل الإعداد والنشر (Vercel + Supabase)

الوقت المتوقع: 45–60 دقيقة في المرة الأولى. تحتاج حسابًا على GitHub وVercel وSupabase، وجهازًا عليه Node.js 20 أو أحدث
(مرة واحدة فقط لتجهيز قاعدة البيانات وإنشاء أول مدير).

## 1) إنشاء قاعدة البيانات (Supabase)
1. أنشئ مشروعًا جديدًا في supabase.com. اختر **الباقة المدفوعة (Pro)** لأن فيها النسخ الاحتياطي اليومي.
2. اختر **Region** بعد مراجعة متطلبات حماية البيانات الشخصية في السعودية (انظر `ASSUMPTIONS.md`).
3. احفظ كلمة مرور قاعدة البيانات (Database password).
4. من Project Settings ← Database انسخ:
   - **Direct connection** (المنفذ 5432) → سيكون `DATABASE_URL_ADMIN`.
   - **Transaction pooler** (المنفذ 6543) → سيكون أساس `DATABASE_URL`.

## 2) تجهيز الجداول والصلاحيات (على جهازك، مرة واحدة)
```bash
git clone <مستودعك> ghamer-crm && cd ghamer-crm
cp .env.example .env.local
npm install
```
عدّل `.env.local`:
- `DATABASE_URL_ADMIN` = اتصال Direct بمستخدم `postgres`.
- `APP_DB_PASSWORD` = كلمة مرور طويلة عشوائية تختارها للمستخدم المحدود `ghamer_app`.
- `DATABASE_URL` = نفس رابط الـ Pooler لكن باسم المستخدم `ghamer_app.<project-ref>` وكلمة المرور `APP_DB_PASSWORD`.
- `APP_ENCRYPTION_KEY` = ناتج `openssl rand -base64 32` (احتفظ به في مكان آمن؛ فقدانه يعني إعادة تفعيل المصادقة الثنائية للجميع).
- `CRON_SECRET` = نص عشوائي لا يقل عن 16 حرفًا.

ثم:
```bash
export $(grep -v '^#' .env.local | xargs)
npm run db:migrate
ADMIN_EMAIL=you@company.com ADMIN_NAME="اسمك" ADMIN_PASSWORD='كلمة-مرور-قوية-123' npm run admin:create
```
> استخدم `DATABASE_URL_ADMIN` من جهازك فقط. **لا تضعه في Vercel.**

## 3) النشر على Vercel
1. ارفع المشروع على GitHub، ثم في Vercel اختر Add New ← Project واستورد المستودع.
2. في Environment Variables أضف فقط: `DATABASE_URL` و`APP_ENCRYPTION_KEY` و`CRON_SECRET` و`SESSION_TTL_HOURS`.
3. اضغط Deploy. المهمة اليومية (التنبيهات) مفعّلة تلقائيًا من `vercel.json` وتعمل 8:00 صباحًا بتوقيت الرياض.
4. اربط نطاقك (Domain). HTTPS يعمل تلقائيًا.

## 4) أول تشغيل
1. ادخل بحساب المدير → سيُطلب منك تغيير كلمة المرور ثم تفعيل المصادقة الثنائية (تطبيق Authenticator).
2. من صفحة **الموظفون** أضف الموظفين وحدّد مدير كل فريق (مدير التيلي سيلز ومدير المبيعات).
3. من **إضافة عميل قائم** أدخل العملاء الحاليين (حوالي 15).
4. من **التارجت** يحدد كل مدير تارجت فريقه.

## 5) النسخ الاحتياطي والاستعادة
- Supabase Pro يأخذ نسخة يومية تلقائيًا. فعّل أيضًا **Point-in-Time Recovery** إن أمكن.
- **اختبر الاستعادة** على مشروع تجريبي قبل التشغيل الفعلي (مطلب في البريف).
- سجل التدقيق محمي من التعديل داخل التطبيق؛ احتفظ بنسخ دورية منه خارج Supabase.

## 6) التحديثات المستقبلية
أي تغيير في الجداول يأتي كملف جديد في `db/migrations/`. شغّل `npm run db:migrate` ثم انشر. لا تعدّل ملفات قديمة.

## مشاكل شائعة
| العرض | الحل |
|---|---|
| `DATABASE_URL is not set` | أضف المتغير في Vercel ثم أعد النشر |
| لا أستطيع تسجيل الدخول بعد 5 محاولات | الحساب مقفل 15 دقيقة تلقائيًا، أو يعيّن Super Admin كلمة مرور جديدة |
| فقدت جهاز المصادقة | لا يوجد استرجاع ذاتي بقصد. يحتاج Super Admin إلى مسح السر من قاعدة البيانات (`update users set mfa_enabled=false, mfa_secret_enc=null where email='…'`) |
