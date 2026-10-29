#!/usr/bin/env bash
# نسخة احتياطية كاملة من قاعدة البيانات قبل أي تغيير خطير (المايجريشن / الاستيراد الكبير).
# الاستخدام:  DATABASE_URL_ADMIN="postgres://postgres:PASSWORD@HOST:5432/postgres" ./scripts/backup.sh
set -euo pipefail
: "${DATABASE_URL_ADMIN:?ضع DATABASE_URL_ADMIN (اتصال المالك، المنفذ 5432)}"
out="backup-$(date +%Y%m%d-%H%M%S).dump"
pg_dump --format=custom --no-owner --file="$out" "$DATABASE_URL_ADMIN"
echo "تم: $out ($(du -h "$out" | cut -f1))"
echo "للاسترجاع: pg_restore --clean --if-exists --no-owner -d \"\$DATABASE_URL_ADMIN\" $out"
