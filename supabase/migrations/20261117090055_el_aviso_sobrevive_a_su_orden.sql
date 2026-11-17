-- ============================================================
-- SdG — El aviso sobrevive a su orden
--
-- POR QUÉ
--
-- La migración 20261018160209 decidió que un aviso se borra con su orden de
-- trabajo (`on delete cascade`). En ese momento era una decisión correcta: sólo
-- **39** avisos tenían enlace a una OT, y la pregunta era qué hacer cuando la
-- sincronización borra una OT que la planilla dejó de traer. Se eligió que el
-- aviso se vaya con ella.
--
-- Ya no es correcta, por dos razones medidas:
--
-- 1. El relleno que viene (las tareas siguientes) enlaza **182 avisos más**, y
--    la superficie de la cascada pasa de 39 a **221**. La sincronización borra
--    OT en cada corrida cuando la planilla deja de traerlas, así que el borrado
--    en cascada deja de ser un caso raro. El aviso es el reporte de una persona,
--    no un detalle de la orden: si la orden se va, el aviso sobrevive y vuelve a
--    decir «sin orden», que es lo verdadero. Borrarlo con ella hace desaparecer
--    un pedido de atención que nadie resolvió.
--
-- 2. `ot_enlazada_en is null` no separa los avisos en dos sino en tres: 17
--    enlaces manuales (Ya tiene OT), 22 OT generadas desde el aviso y 182 por
--    resolver. Hace falta una columna propia que diga cuándo la resolvió el
--    **sistema** desde el número tipeado en la planilla, para distinguir ese
--    enlace automático de los otros dos. Sin ella, vaciar la celda OT ASIGNADA
--    de la planilla orfanaría una de las 22 OT generadas desde el aviso, que es
--    justo lo que no hay que hacer.
--
-- QUÉ CAMBIA
--
-- - La FK `avisos_work_order_id_fkey` pasa de `on delete cascade` a
--   `on delete set null`. Si la OT se borra, el aviso queda con `work_order_id`
--   en null y sigue existiendo.
-- - Nueva columna `avisos.ot_resuelta_en timestamptz`, null por defecto. La
--   escribe **sólo** la resolución automática (el relleno y la sincronización),
--   igual que `ot_enlazada_en` la escribe sólo la ruta de enlazar a mano.
--
-- LO QUE HAY QUE SABER, Y NO ES OBVIO
--
-- **`avisos` es a su vez un espejo de su propia planilla.** Si el aviso sigue
-- en la hoja AVISOS, la sincronización de avisos lo va a volver a traer en su
-- próxima corrida, sin enlace a ninguna OT. Con `set null` eso ya no es un
-- problema de borrado: el aviso sobrevive y la planilla lo sigue diciendo, así
-- que las dos cosas coinciden. La regla de cada planilla gobernando su tabla
-- se mantiene.
--
-- **`ot_resuelta_en` no se puede deducir de `work_order_id`.** Una fila con
-- `work_order_id` y `ot_resuelta_en` null es un enlace manual o una OT nacida
-- del aviso, y ninguna de esas dos cosas debe quedar desenlazada por una
-- sincronización que vacíe la celda de la planilla. Esa distinción es lo que
-- esta columna guarda.
--
-- LO QUE ESTA MIGRACIÓN NO TOCA
--
-- Los otros ocho hijos de `ordenes_trabajo` quedan como están. Medido con
-- `node scripts/que-cuelga-de.mjs ordenes_trabajo` el 17/11/2026: `agenda_eventos`,
-- `ordenes_trabajo_notas` y `ordenes_trabajo_repuestos` se borran en cascada
-- —son partes de la orden y sin ella no significan nada—, y
-- `mant_cuadernos_renglones`, `mant_partes_contratista_renglones`,
-- `mantenimientos_ejecuciones`, `planificacion_diaria_items` y
-- `produccion_molino_paradas` ya estaban en `set null`, que es a lo que este
-- cambio suma `avisos`. O sea que de los nueve, el aviso era el único registro
-- con vida propia que se iba con la orden.
--
-- Esta migración es nueva: no edita la 20261018160209, que puede estar aplicada.
-- Se corrige con otra, como manda el README de migraciones. Es idempotente:
-- `drop constraint if exists`, `add column if not exists`, y el comment se puede
-- repetir sin efecto.
-- ============================================================

alter table public.avisos
  drop constraint if exists avisos_work_order_id_fkey;

alter table public.avisos
  add constraint avisos_work_order_id_fkey
  foreign key (work_order_id) references public.ordenes_trabajo(id) on delete set null;

alter table public.avisos
  add column if not exists ot_resuelta_en timestamptz;

comment on column public.avisos.ot_resuelta_en is
  'Cuándo la resolvió el sistema desde el número tipeado en OT ASIGNADA. Null es que el enlace no es automático: lo hizo «Ya tiene OT» (ot_enlazada_en) o la OT nació de este aviso.';

comment on column public.avisos.work_order_id is
  'La OT que atendió este aviso. Si esa OT se borra, el aviso sobrevive con este campo en null: el aviso es el reporte de una persona y no se va con la orden.';
