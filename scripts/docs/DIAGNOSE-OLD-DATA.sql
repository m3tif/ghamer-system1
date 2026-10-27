-- فحص للقراءة فقط (لا يغيّر أي بيانات). شغّله في Supabase SQL Editor لتفهم أي مواعيد قديمة غريبة قبل أي تعديل.

-- 1) اجتماعات نشطة موعدها في الماضي (كانت تظهر خطأً كـ «قادمة» في النسخة القديمة؛ الآن تظهر تحت «بانتظار تسجيل النتيجة»)
select m.id, c.name, m.status, m.scheduled_at, now() - m.scheduled_at as مضى
from meetings m join leads l on l.id = m.lead_id join clients c on c.id = l.client_id
where m.status in ('Scheduled','Confirmed','Rescheduled') and m.scheduled_at < now() order by m.scheduled_at;

-- 2) اجتماعات بعيدة جدًا في المستقبل (أكثر من 90 يومًا) قد تدل على خطأ في إدخال التاريخ
select m.id, c.name, m.status, m.scheduled_at from meetings m
join leads l on l.id = m.lead_id join clients c on c.id = l.client_id
where m.status in ('Scheduled','Confirmed','Rescheduled') and m.scheduled_at > now() + interval '90 days';

-- 3) أكثر من اجتماع نشط لنفس العميل (لا يجب أن يحدث؛ قيد في القاعدة يمنعه)
select lead_id, count(*) from meetings where status in ('Scheduled','Confirmed','Rescheduled') group by 1 having count(*) > 1;

-- 4) متابعات مفتوحة متكررة لنفس العميل في نفس اليوم (قد تفسّر «مواعيد متكررة»)
select lead_id, due_at::date as day, count(*) from follow_ups where status = 'open' group by 1, 2 having count(*) > 1 order by 3 desc;

-- 5) أوقات الاجتماعات بتوقيت الشركة الحالي مقابل UTC، لمراجعة فرق الساعة يدويًا قبل أي قرار
select m.id, c.name, m.scheduled_at as utc, m.scheduled_at at time zone app.company_tz() as بتوقيت_الشركة
from meetings m join leads l on l.id = m.lead_id join clients c on c.id = l.client_id order by m.scheduled_at desc limit 50;
