-- 003_reference_data.sql — departments, roles, permissions (static reference data; safe for production)
insert into departments(code, name_ar, name_en) values
 ('management','الإدارة','Management'),
 ('tele_sales','التيلي سيلز','Tele Sales'),
 ('sales','المبيعات','Sales'),
 ('finance','المالية','Finance'),
 ('operations','العمليات','Operations'),
 ('technical','الفريق التقني','Technical Team');

insert into roles(code, name_ar, name_en, department_id, is_manager, mfa_required)
select r.code, r.name_ar, r.name_en, d.id, r.is_manager, r.mfa
from (values
 ('super_admin','مدير النظام','Super Admin','management',true,true),
 ('general_manager','المدير العام','General Manager','management',true,true),
 ('tele_sales_manager','مدير التيلي سيلز','Tele Sales Manager','tele_sales',true,true),
 ('tele_sales','تيلي سيلز','Tele Sales','tele_sales',false,false),
 ('sales_manager','مدير المبيعات','Sales Manager','sales',true,true),
 ('sales_rep','مندوب مبيعات','Sales Representative','sales',false,false),
 ('finance_manager','مدير المالية','Finance Manager','finance',true,true),
 ('finance_employee','موظف مالية','Finance Employee','finance',false,true),
 ('operations_manager','مدير العمليات','Operations Manager','operations',true,true),
 ('account_manager','أكاونت مانجر','Account Manager','operations',false,false),
 ('technical_team_leader','قائد الفريق التقني','Technical Team Leader','technical',true,false),
 ('technical_employee','موظف تقني','Technical Employee','technical',false,false)
) as r(code, name_ar, name_en, dept, is_manager, mfa)
join departments d on d.code = r.dept;

insert into permissions(key, description) values
 ('leads.view','عرض العملاء المحتملين'),
 ('leads.create','تسجيل عميل جديد'),
 ('leads.edit','تعديل بيانات التواصل والحالة'),
 ('leads.transfer','نقل ملكية عميل'),
 ('leads.export','تصدير بيانات العملاء'),
 ('leads.correct_source','تصحيح مصدر العميل (استثنائي)'),
 ('meetings.view','عرض الاجتماعات'),
 ('meetings.create','حجز اجتماع'),
 ('meetings.manage','تحديث حالة الاجتماع'),
 ('deals.view','عرض الصفقات'),
 ('deals.edit','تعديل الصفقات والبريف'),
 ('deals.reassign','إعادة إسناد صفقة'),
 ('duplicates.request','طلب مراجعة ملكية'),
 ('duplicates.review','مراجعة حالات التكرار'),
 ('targets.view','عرض التارجت'),
 ('targets.edit','تحديد التارجت'),
 ('followups.manage','إدارة المتابعات'),
 ('employees.view','عرض الموظفين'),
 ('employees.manage','إدارة الموظفين والحسابات'),
 ('roles.manage','إدارة الأدوار والصلاحيات'),
 ('audit.view','عرض سجل التدقيق'),
 ('reports.team','تقارير الفريق'),
 ('reports.all','تقارير الشركة'),
 ('quotations.manage','عروض الأسعار'),
 ('contracts.view','عرض العقود'),
 ('contracts.manage','إدارة العقود'),
 ('finance.view','عرض البيانات المالية'),
 ('finance.record','تسجيل الدفعات'),
 ('finance.verify','التحقق من الدفعات'),
 ('finance.approve','الاعتماد المالي'),
 ('commissions.view','عرض العمولات'),
 ('commissions.approve','اعتماد العمولات'),
 ('commissions.rules','تعديل قواعد العمولات'),
 ('ops.view','عرض قائمة العمليات'),
 ('ops.assign','توزيع العملاء على الأكاونت'),
 ('projects.view','عرض المشاريع'),
 ('projects.manage','إدارة المشاريع'),
 ('tasks.view_own','عرض مهامي'),
 ('tasks.manage','إنشاء وتوزيع المهام'),
 ('tasks.review','مراجعة التسليمات'),
 ('time.log','تسجيل وقت العمل'),
 ('time.edit_old','تعديل سجل وقت قديم'),
 ('profitability.view','عرض الربحية'),
 ('costs.manage','إدارة تكلفة الساعة والتكاليف'),
 ('export.bulk','تصدير بيانات كبيرة'),
 ('settings.manage','إدارة الإعدادات');

-- (role, permission, scope)
with grants(role_code, perm, scope) as (values
 -- general manager: view everything, edit nothing
 ('general_manager','leads.view','all'),('general_manager','meetings.view','all'),('general_manager','deals.view','all'),
 ('general_manager','targets.view','all'),('general_manager','employees.view','all'),('general_manager','audit.view','all'),
 ('general_manager','reports.all','all'),('general_manager','contracts.view','all'),('general_manager','finance.view','all'),
 ('general_manager','commissions.view','all'),('general_manager','ops.view','all'),('general_manager','projects.view','all'),
 ('general_manager','profitability.view','all'),
 -- tele sales manager
 ('tele_sales_manager','leads.view','team'),('tele_sales_manager','leads.create','own'),('tele_sales_manager','leads.edit','team'),
 ('tele_sales_manager','leads.transfer','team'),('tele_sales_manager','meetings.view','team'),('tele_sales_manager','meetings.create','team'),
 ('tele_sales_manager','meetings.manage','team'),('tele_sales_manager','duplicates.review','team'),('tele_sales_manager','duplicates.request','own'),
 ('tele_sales_manager','targets.view','team'),('tele_sales_manager','targets.edit','team'),('tele_sales_manager','followups.manage','team'),
 ('tele_sales_manager','reports.team','team'),('tele_sales_manager','commissions.view','team'),('tele_sales_manager','employees.view','team'),
 -- tele sales
 ('tele_sales','leads.view','own'),('tele_sales','leads.create','own'),('tele_sales','leads.edit','own'),
 ('tele_sales','meetings.view','own'),('tele_sales','meetings.create','own'),('tele_sales','meetings.manage','own'),
 ('tele_sales','duplicates.request','own'),('tele_sales','targets.view','own'),('tele_sales','followups.manage','own'),
 ('tele_sales','commissions.view','own'),
 -- sales manager
 ('sales_manager','leads.view','team'),('sales_manager','leads.create','own'),('sales_manager','leads.edit','team'),
 ('sales_manager','leads.transfer','team'),('sales_manager','meetings.view','team'),('sales_manager','meetings.manage','team'),
 ('sales_manager','deals.view','team'),('sales_manager','deals.edit','team'),('sales_manager','deals.reassign','team'),
 ('sales_manager','duplicates.request','own'),('sales_manager','duplicates.review','team'),
 ('sales_manager','targets.view','team'),('sales_manager','targets.edit','team'),('sales_manager','followups.manage','team'),
 ('sales_manager','quotations.manage','team'),('sales_manager','contracts.view','team'),('sales_manager','reports.team','team'),
 ('sales_manager','commissions.view','team'),('sales_manager','employees.view','team'),
 -- sales rep
 ('sales_rep','leads.view','own'),('sales_rep','leads.create','own'),('sales_rep','leads.edit','own'),
 ('sales_rep','meetings.view','own'),('sales_rep','meetings.manage','own'),('sales_rep','meetings.create','own'),('sales_rep','deals.view','own'),('sales_rep','deals.edit','own'),
 ('sales_rep','duplicates.request','own'),('sales_rep','targets.view','own'),('sales_rep','followups.manage','own'),
 ('sales_rep','quotations.manage','own'),('sales_rep','contracts.view','own'),('sales_rep','commissions.view','own'),
 -- finance
 ('finance_manager','finance.view','all'),('finance_manager','finance.record','all'),('finance_manager','finance.verify','all'),
 ('finance_manager','finance.approve','all'),('finance_manager','contracts.view','all'),('finance_manager','commissions.view','all'),
 ('finance_manager','commissions.approve','all'),('finance_manager','commissions.rules','all'),('finance_manager','profitability.view','all'),
 ('finance_manager','costs.manage','all'),('finance_manager','audit.view','all'),('finance_manager','reports.all','all'),
 ('finance_employee','finance.view','all'),('finance_employee','finance.record','all'),('finance_employee','contracts.view','all'),
 ('finance_employee','commissions.view','all'),('finance_employee','profitability.view','all'),
 -- operations
 ('operations_manager','ops.view','all'),('operations_manager','ops.assign','all'),('operations_manager','projects.view','all'),
 ('operations_manager','projects.manage','all'),('operations_manager','tasks.manage','all'),('operations_manager','tasks.review','all'),
 ('operations_manager','contracts.view','all'),('operations_manager','employees.view','all'),
 ('account_manager','projects.view','own'),('account_manager','projects.manage','own'),('account_manager','tasks.manage','own'),
 ('account_manager','tasks.review','own'),('account_manager','time.log','own'),('account_manager','tasks.view_own','own'),
 ('technical_team_leader','tasks.view_own','team'),('technical_team_leader','tasks.manage','team'),('technical_team_leader','time.log','own'),
 ('technical_employee','tasks.view_own','own'),('technical_employee','time.log','own')
)
insert into role_permissions(role_id, permission_key, scope)
select r.id, g.perm, g.scope from grants g join roles r on r.code = g.role_code;

-- super admin: everything, all scope
insert into role_permissions(role_id, permission_key, scope)
select r.id, p.key, 'all' from roles r cross join permissions p where r.code = 'super_admin';

insert into settings(key, value) values
 ('timezone', '"Asia/Riyadh"'),
 ('currency', '"SAR"'),
 ('vat_rate', '0.15'),
 ('session_ttl_hours', '12'),
 ('followup_overdue_grace_minutes', '0');
