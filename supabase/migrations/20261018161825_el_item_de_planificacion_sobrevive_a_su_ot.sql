-- Un ítem de planificación diaria deja de impedir que se borre su OT.
--
-- POR QUÉ
--
-- `planificacion_diaria_items.work_order_id` venía de la migración 005 sin
-- `on delete`, o sea `no action`: con un ítem apuntándole, borrar esa orden de
-- trabajo **falla**. Era inofensivo mientras nadie borraba órdenes. Desde el
-- 18/10/2026 la sincronización borra la OT que la planilla dejó de traer, y
-- ahí deja de serlo.
--
-- Y no falla sólo esa orden. El borrado va **de a lotes de 200 ids** —un
-- `.in()` con muchos arma una URL que PostgREST rechaza—, así que un solo ítem
-- de planificación tumba el `delete` de las 200 que viajan con ella. Se
-- informa y el resto queda para la próxima corrida, pero esa OT no se va a ir
-- nunca sola: cada corrida la vuelve a intentar y vuelve a fallar.
--
-- POR QUÉ `SET NULL` Y NO `CASCADE`
--
-- Porque el ítem no es de la OT: es del plan del día, que alguien armó y que
-- siguió existiendo. Borrarlo cambiaría lo que dice un plan ya pasado, que es
-- justamente lo que no hay que tocar.
--
-- Y porque **no pierde la referencia**: `planificacion_diaria_items` guarda
-- también `ot_number`, además de `especialidad`, `sector_raw`, `equipo_raw` y
-- `descripcion`, todos copiados al planificar. Con el enlace en null el ítem
-- sigue diciendo qué se había planificado y para qué orden; lo único que se
-- pierde es poder navegar a una fila que ya no existe.
--
-- Es la misma respuesta que ya daban `avisos` y `mantenimientos_ejecuciones`
-- —las tres son cosas que pasaron y que la OT no gobierna—. `avisos` se movió
-- a `cascade` hoy, a pedido y por otra razón: un aviso cuya OT se borró de la
-- planilla es un aviso que no tendría que estar. Un ítem de un plan de la
-- semana pasada sí tiene que estar.
--
-- Hoy no hay ninguna fila enlazada, así que esto no mueve un dato: cambia lo
-- que va a pasar cuando la haya.
--
-- (La migración `20261018160209` dice que esto "se deja como está porque
-- cambiarlo no se pidió". Se pidió unos minutos después; ésta es la que lo
-- cambia.)

alter table planificacion_diaria_items
  drop constraint if exists planificacion_diaria_items_work_order_id_fkey;

alter table planificacion_diaria_items
  add constraint planificacion_diaria_items_work_order_id_fkey
  foreign key (work_order_id) references ordenes_trabajo(id) on delete set null;

comment on column planificacion_diaria_items.work_order_id is
  'La OT que se planificó. Si esa OT se borra —porque la planilla dejó de '
  'traerla—, el ítem queda con el enlace en null: el plan de ese día no se '
  'reescribe, y `ot_number` y los campos copiados siguen diciendo qué se había '
  'planificado.';
