-- ============================================================
-- SdG — Seed del núcleo (empresas y sectores base)
-- Idempotente: se puede correr varias veces sin duplicar.
-- ============================================================

insert into empresas (nombre) values ('POLCECAL'), ('POLYSAN')
on conflict (nombre) do nothing;

-- Sectores base por empresa (ajustar a la realidad del grupo).
insert into sectores (empresa_id, nombre)
select e.id, s.nombre
from empresas e
cross join (values ('Calidad'), ('Producción'), ('Mantenimiento'), ('Administración')) as s(nombre)
on conflict (empresa_id, nombre) do nothing;
