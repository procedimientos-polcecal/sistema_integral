-- ============================================================
-- SdG — Mantenimiento: por qué una OT todavía no se hizo
--
-- Hoy hay 40 órdenes abiertas —24 atrasadas, 12 por hacer, 4 en proceso— y
-- ninguna tiene dónde decir por qué. La observación que existe se completa al
-- **realizar** el trabajo: vive en la ejecución y en la columna W de la
-- planilla, así que una OT que sigue abierta no tiene de dónde colgarla.
--
-- Es una tabla y no una columna a propósito. Una OT atrasada se vuelve a
-- justificar con el tiempo —"falta el repuesto" y dos meses después "esperamos
-- la parada de planta"— y pisar la razón anterior borra la única señal de que
-- se viene postergando, que es lo que la revisión quiere ver. A la planilla,
-- que tiene una celda y no una lista, va la última: la escribe la app en la
-- columna X.
-- ============================================================

create table if not exists ordenes_trabajo_notas (
  id         uuid primary key default gen_random_uuid(),
  -- `orden_id` y no `work_order_id`: en esta casa se escribe en castellano.
  -- Las dos tablas que ya cuelgan de una OT —`ordenes_trabajo_repuestos` y
  -- `mantenimientos_ejecuciones`— lo tienen en inglés porque llegaron así del
  -- repo de origen; la 029 renombró las tablas por esto mismo y dejó las
  -- columnas por inercia. Una tercera copiando el error no lo arregla.
  orden_id   uuid not null references ordenes_trabajo(id) on delete cascade,
  texto      text not null,
  creado_por uuid references usuarios(id),
  creado_en  timestamptz not null default now()
);

comment on table ordenes_trabajo_notas is
  'Por qué una orden de trabajo todavía no se hizo. Historial: cada justificación queda, no se edita. A la columna X de la planilla va la última.';

-- Siempre se leen todas las de una orden, ordenadas de la más nueva a la más
-- vieja. El índice es esa consulta.
create index if not exists ordenes_trabajo_notas_orden_idx
  on ordenes_trabajo_notas (orden_id, creado_en desc);

alter table ordenes_trabajo_notas enable row level security;

-- Las llamadas van envueltas en un `select`. Pelada, Postgres evalúa el `USING`
-- una vez por fila aunque la función sea STABLE; el subselect lo vuelve un
-- InitPlan que se evalúa una sola vez. Es la regla que el 14/10/2026 dejó de
-- costar: con las 249 policies envueltas, todo quedó entre ×1,0 y ×1,3 contra
-- la misma consulta sin RLS.
drop policy if exists ordenes_trabajo_notas_read on ordenes_trabajo_notas;
create policy ordenes_trabajo_notas_read on ordenes_trabajo_notas
  for select to authenticated using ((select mant_puede_ver()));

drop policy if exists ordenes_trabajo_notas_insert on ordenes_trabajo_notas;
create policy ordenes_trabajo_notas_insert on ordenes_trabajo_notas
  for insert to authenticated with check ((select mant_puede_editar()));

-- No hay policy de update, y es la decisión: un historial que se puede
-- reescribir no es un historial. Un error se arregla borrando la propia nota y
-- escribiendo otra, que deja la corrección a la vista.
--
-- Borrar, sólo la propia. `creado_por` depende de la fila, así que esa llamada
-- **no se envuelve**: evaluarla una sola vez le dejaría a cualquiera borrar las
-- notas del primero de la lista. Es la excepción de la regla de arriba, y la
-- única de este tema que es un agujero de permisos y no una lentitud.
drop policy if exists ordenes_trabajo_notas_delete on ordenes_trabajo_notas;
create policy ordenes_trabajo_notas_delete on ordenes_trabajo_notas
  for delete to authenticated using (creado_por = (select auth.uid()));
