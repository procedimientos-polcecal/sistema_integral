-- ============================================================
-- SdG — La fecha de fin estimada de una OT llega a la base
--
-- Desde el 04/11/2026 el formulario de la OT pide «fecha de fin», pero hasta
-- ahora ese dato iba sólo a la planilla (la columna FECHA DE FIN del libro de
-- respuestas, que el master junta): `ordenes_trabajo` no tenía dónde guardarlo
-- y mandárselo a PostgREST cortaba el insert entero.
--
-- Hace falta en la base porque la grilla del mes de la Agenda tiene que pintar
-- una orden en cada día de su ventana. Una orden que va de lunes a miércoles y
-- sólo aparece el lunes hace que el martes parezca vacío, y «cuántas hay ese
-- día» es justo la decisión que se toma en esa pantalla.
--
-- Una columna, nullable, sin backfill. Es sólo DDL y se puede correr dos veces: `add
-- column if not exists` no falla en la segunda corrida.
-- ============================================================

alter table public.ordenes_trabajo
  add column if not exists fecha_fin date;

comment on column public.ordenes_trabajo.fecha_fin is
  'Cuándo se estima que termina la orden (último día de su ventana; el primero es fecha_ejecucion). VACÍA QUIERE DECIR «DURA UN DÍA», no que falte el dato: es la misma convención que fecha_hasta en el cuaderno del contratista. Las órdenes anteriores al 04/11/2026 la tienen vacía porque hasta entonces el valor vivía sólo en la planilla; no hay backfill, y leerlas como «un día» es lo correcto, no una pérdida. La escribe el alta (POST /api/mantenimiento/ordenes) y la importa la sincronización desde la columna FECHA DE FIN del master, buscada por el nombre del encabezado y no por la letra.';
