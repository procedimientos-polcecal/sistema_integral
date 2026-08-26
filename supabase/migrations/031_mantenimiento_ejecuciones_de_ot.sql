-- ============================================================
-- SdG — Mantenimiento: registrar el trabajo de una OT
--
-- Hasta ahora una ejecución sólo podía colgar de un mantenimiento programado.
-- Pero la mayor parte del trabajo que se hace en la planta entra por una orden
-- de trabajo, y ese registro —quién lo hizo, cuánto tardó, qué observó— no
-- tenía dónde guardarse.
-- ============================================================

alter table mantenimientos_ejecuciones
  add column if not exists work_order_id uuid references ordenes_trabajo(id) on delete set null;

create index if not exists me_work_order_idx
  on mantenimientos_ejecuciones (work_order_id);

-- `schedule_id` deja de ser obligatorio de hecho: una ejecución cuelga de un
-- mantenimiento programado o de una OT, y ahora puede ser cualquiera de las
-- dos. La columna ya era nullable, así que no hay nada que aflojar.

comment on column mantenimientos_ejecuciones.work_order_id is
  'La OT que se registró. Excluyente con schedule_id: una ejecución viene de un mantenimiento programado o de una orden de trabajo.';
