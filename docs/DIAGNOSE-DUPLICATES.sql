-- قراءة فقط. لا تحذف شيئًا تلقائيًا؛ كل حالة تُراجَع من المدير.

-- 1) نفس الرقم مسجل لأكثر من عميل (يجب ألا يحدث بعد 012؛ إن ظهر شيء فهو من بيانات قديمة تحتاج مراجعة)
select value, count(*) clients, array_agg(client_id) from client_identifiers where kind = 'phone' group by value having count(*) > 1;

-- 2) أرقام متشابهة (آخر 9 أرقام) برمز دولة مختلف = غالبًا نفس الشخص، يحتاج قرار بشري
select right(regexp_replace(value,'\D','','g'),9) tail, array_agg(value order by value) numbers, array_agg(client_id) clients
from client_identifiers where kind = 'phone' group by 1 having count(distinct value) > 1;

-- 3) نفس الاسم لعملاء مختلفين (مسموح، للعلم فقط)
select name, count(*) from clients group by name having count(*) > 1 order by 2 desc limit 50;

-- 4) طلبات المراجعة المفتوحة (تظهر أيضًا في صفحة «مراجعة التكرار»)
select id, reason, created_at from duplicate_reviews where status = 'open' order by created_at;
