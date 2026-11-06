-- El aviso se borra con su orden de trabajo.
--
-- POR QUÉ
--
-- Desde el 18/10/2026 la sincronización borra la OT que la planilla dejó de
-- tener. Hasta ahora, cuando esa OT tenía un aviso enlazado, el aviso se
-- quedaba con `work_order_id` en null: sobrevivía a la orden que lo había
-- atendido, y volvía a verse como un aviso sin atender. A pedido, se decidió
-- que se vaya con ella.
--
-- Es un cambio de criterio, no un arreglo: `set null` era una respuesta
-- razonable —"perdí el enlace pero el aviso existió"— y la que se elige ahora
-- es la otra, que dice que un aviso cuya OT alguien borró de la planilla es un
-- aviso que no tendría que estar.
--
-- LO QUE HAY QUE SABER, Y NO ES OBVIO
--
-- **`avisos` es a su vez un espejo de su propia planilla.** Si el aviso sigue
-- estando en la hoja AVISOS, la sincronización de avisos lo va a volver a
-- traer en su próxima corrida, esta vez sin enlace a ninguna OT. O sea que el
-- borrado en cascada es definitivo sólo si la línea también se sacó de la hoja
-- AVISOS. No es un error: cada planilla gobierna su tabla, y la de avisos
-- sigue diciendo que ese aviso existe.
--
-- Hoy esto no afecta a ninguna fila: de los 172 avisos, **ninguno** tiene
-- `work_order_id`. La cascada empieza a importar cuando se empiecen a enlazar.
--
-- LO QUE ESTA MIGRACIÓN NO TOCA
--
-- `planificacion_diaria_items.work_order_id` sigue en `no action`, y es el
-- único de los cinco que **hace fallar** el borrado de una OT. Hoy no tiene
-- ninguna fila enlazada, así que no muerde; cuando la tenga, el borrado de esa
-- OT —y el del lote de 200 en el que viaje— va a fallar entero. Se deja como
-- está porque cambiarlo no se pidió, y queda anotado acá para que el día que
-- falle no haya que averiguarlo de nuevo.

alter table avisos
  drop constraint if exists avisos_work_order_id_fkey;

alter table avisos
  add constraint avisos_work_order_id_fkey
  foreign key (work_order_id) references ordenes_trabajo(id) on delete cascade;

comment on column avisos.work_order_id is
  'La OT que atendió este aviso. Si esa OT se borra —porque la planilla de OT '
  'dejó de traerla—, el aviso se borra con ella. Ojo: `avisos` espeja su propia '
  'planilla, así que si la línea sigue en la hoja AVISOS la próxima '
  'sincronización lo vuelve a traer, sin enlace.';
