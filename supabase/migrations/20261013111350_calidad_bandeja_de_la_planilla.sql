-- ============================================================
-- SdG — Calidad: la bandeja ahora es de la planilla, no de Odoo
--
-- Odoo deja de crear movimientos de carbonilla —la planilla pasa a mandar sobre
-- el libro entero— así que no hay más "líneas de Odoo sin reconocer". Lo que sí
-- hay que ver son FILAS DE LA PLANILLA que no se pudieron convertir, y ésas se
-- identifican por número de fila.
--
-- POR QUÉ LA FILA SIRVE COMO CLAVE, medido el 13/10/2026 sobre el libro real:
-- 0 filas fuera de orden cronológico en 3.399, y 1.000 de 1.000 filas
-- importadas siguen diciendo lo mismo que el SdG guardó de ellas. La planilla se
-- escribe siempre al final, nunca en el medio. Si alguna vez se reordena, esto
-- es lo primero que hay que mirar.
--
-- La tabla vieja se borra en vez de quedar vacía: tiene 0 filas, y una tabla
-- muerta con nombre vigente es de las trampas que más caro salen de encontrar
-- meses después.
--
-- Diseño: docs/superpowers/specs/2026-10-13-calidad-la-planilla-manda-design.md
-- ============================================================

create table public.calidad_planilla_sin_reconocer (
  fila            integer primary key,
  fecha           date,
  codigo          text,
  descripcion     text,
  entradas        numeric(12,3),
  salidas         numeric(12,3),
  motivo          text not null,
  visto_en        timestamptz not null default now()
);

create index calidad_planilla_sin_reconocer_fecha
  on public.calidad_planilla_sin_reconocer (fecha);

alter table public.calidad_planilla_sin_reconocer enable row level security;

create policy calidad_planilla_sin_reconocer_leer
  on public.calidad_planilla_sin_reconocer
  for select using (tiene_acceso_calidad());

create policy calidad_planilla_sin_reconocer_escribir
  on public.calidad_planilla_sin_reconocer
  for all using (puede_editar_calidad()) with check (puede_editar_calidad());

-- Y la de Odoo se va. Tiene 0 filas.
drop table if exists public.calidad_odoo_sin_reconocer;
