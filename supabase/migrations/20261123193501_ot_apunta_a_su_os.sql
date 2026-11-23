-- ============================================================
-- SdG — La OT apunta a la OS que la cubre
--
-- POR QUÉ
--
-- Una orden de servicio (OS) puede cubrir una orden de trabajo (OT), y hasta
-- ahora ese vínculo no existía como dato: no hay ninguna clave foránea entre
-- `ordenes_trabajo` y `ordenes_servicio`. Para poder crear una OS desde el
-- sistema, la OT necesita decir cuál es la suya. Esta columna es ese enlace.
--
-- POR QUÉ `on delete set null` Y NO `cascade`
--
-- En Mantenimiento manda la planilla, y desde el 18/10/2026 **lo que la planilla
-- deja de tener se borra de la base**: las OT, los avisos, las órdenes de
-- servicio y los requerimientos de Compras se espejan por número, así que una
-- fila que alguien saca de la planilla se borra de verdad acá. O sea que una OS
-- puede desaparecer porque alguien borró su fila, y eso **no es razón para
-- llevarse la OT**: la orden de trabajo existe por sí misma, tiene su propia fila
-- en su propia planilla y su trabajo se hizo igual. Con `cascade` se perdería la
-- OT y todo lo que le cuelga (notas, repuestos, eventos de la agenda). Con
-- `set null` la OT queda diciendo que ya no se sabe qué OS la cubría, que es lo
-- cierto. Es el mismo criterio que `20261117090055_el_aviso_sobrevive_a_su_orden`:
-- el registro con vida propia sobrevive al borrado del espejo que lo apuntaba.
--
-- LO QUE HAY QUE SABER
--
-- - Nada apunta a `ordenes_servicio` por clave foránea, así que esta columna no
--   crea un segundo camino entre dos tablas que ya estuvieran enlazadas: no hay
--   `select()` con embed entre ellas que pueda empezar a dar `PGRST201`. Eso
--   está **medido contra la base** con `node scripts/que-cuelga-de.mjs
--   ordenes_servicio` el 23/11/2026 («Nada apunta a "ordenes_servicio" por clave
--   foránea»), y **no deducido de las migraciones**: `ordenes_servicio` la creó
--   un delta aplicado a mano y no tiene `create table` en ningún archivo de
--   `supabase/migrations/`, así que un grep ahí no puede contestar esta
--   pregunta —una FK creada en el delta le es invisible—. (El script termina con
--   un assert de libuv en Windows al cerrar el proceso, después de imprimir: la
--   respuesta sale igual.) Cuando alguien embeba una desde la otra, que nombre
--   la FK (`ordenes_servicio!os_id(...)`).
-- - No hace falta policy nueva: es una columna de una tabla que ya tiene las suyas.
-- - `ordenes_trabajo` figura en `lib/asistente/catalogo.generado.json`: después de
--   aplicar esta migración hay que correr `npm run catalogo`, o el Asistente
--   queda ciego a `os_id`.
-- - **Hasta que esta migración esté aplicada, ninguna cadena `select()` puede
--   nombrar `os_id`.** El deploy es automático con el push y el SQL lo corre una
--   persona después: nombrarla antes rompe lo que ya andaba.
--
-- Es idempotente (`add column if not exists`, `create index if not exists`) y
-- nueva: no edita ninguna migración anterior.
-- ============================================================

alter table public.ordenes_trabajo
  add column if not exists os_id uuid
  references public.ordenes_servicio(id) on delete set null;

comment on column public.ordenes_trabajo.os_id is
  'La orden de servicio que cubre esta OT. Si la OS se borra (porque la planilla dejó de tener su fila) la OT sobrevive con este campo en null.';

-- Sin índice, borrar una OS recorre `ordenes_trabajo` entera para poner el null,
-- y el borrado de espejo borra de a muchas.
create index if not exists ordenes_trabajo_os_id_idx
  on public.ordenes_trabajo (os_id)
  where os_id is not null;
