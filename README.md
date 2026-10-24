# Ghamer CRM — Phase 1 (CRM Foundation)

نظام إدارة غامر. هذه المرحلة تغطي: الموظفون والصلاحيات، تسجيل العملاء مع منع التكرار، Tele Sales، الاجتماعات والتارجت،
خط المبيعات والبريف والمتابعات، الإشعارات، سجل التدقيق، ولوحات الأداء.

## التقنية
Next.js 15 (App Router) + TypeScript + Tailwind v4 · PostgreSQL (Supabase) · `pg` + SQL migrations · Argon2id · TOTP MFA.

## التشغيل المحلي
```bash
cp .env.example .env.local          # املأ القيم
npm install
npm run db:migrate                  # ينشئ الجداول والصلاحيات
npm run admin:create                # أول Super Admin
npm run db:seed                     # (اختياري) بيانات تجريبية
npm run dev                         # http://localhost:3000
npm test                            # 61 اختبارًا (يحتاج PostgreSQL محلي، انظر docs/TESTING.md)
```
الدليل الكامل للإعداد والنشر بالعربية: [`docs/SETUP-AR.md`](docs/SETUP-AR.md)

## هيكل المشروع
- `db/migrations/` — مصدر الحقيقة للأمان: الجداول، RLS، الدوال، الـ Triggers.
- `src/server/` — طبقة البيانات و Server Actions. `src/lib/` — المصادقة، التطبيع، التشفير.
- `src/app/` — الصفحات. `tests/` — اختبارات الأمان وقواعد العمل.
