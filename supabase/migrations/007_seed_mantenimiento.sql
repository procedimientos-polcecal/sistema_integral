-- ============================================================
-- SdG — Seed de prueba del módulo Mantenimiento
-- Idempotente: se puede correr varias veces sin duplicar.
-- Usa el sector "Mantenimiento" ya sembrado por empresa en 003_seed_nucleo.
-- ============================================================

insert into equipos (sector_id, name, code, power_kw, criticality)
select s.id, 'Compresor A1', 'PO-A1-01', 55, 'ALTA'
from sectores s
join empresas e on e.id = s.empresa_id
where e.nombre = 'POLCECAL' and s.nombre = 'Mantenimiento'
and not exists (select 1 from equipos where code = 'PO-A1-01');

insert into equipos (sector_id, name, code, power_kw, criticality)
select s.id, 'Cinta transportadora B1', 'PY-B1-01', 15, 'MEDIA'
from sectores s
join empresas e on e.id = s.empresa_id
where e.nombre = 'POLYSAN' and s.nombre = 'Mantenimiento'
and not exists (select 1 from equipos where code = 'PY-B1-01');

insert into equipos_checklists (equipment_id, name, items, is_active)
select eq.id, 'Checklist mensual',
  '[{"id":"1","label":"Nivel de aceite","type":"check","required":true},
    {"id":"2","label":"Temperatura de trabajo","type":"number","required":false,"unit":"°C"}]'::jsonb,
  true
from equipos eq
where eq.code = 'PO-A1-01'
and not exists (select 1 from equipos_checklists where equipment_id = eq.id);

insert into mantenimientos_programados (equipment_id, checklist_id, maintenance_type, schedule_type, next_date, description)
select eq.id, ch.id, 'Lubricacion', 'MENSUAL', current_date + interval '15 days', 'Lubricación mensual de rodamientos'
from equipos eq
join equipos_checklists ch on ch.equipment_id = eq.id
where eq.code = 'PO-A1-01'
and not exists (select 1 from mantenimientos_programados where equipment_id = eq.id);
