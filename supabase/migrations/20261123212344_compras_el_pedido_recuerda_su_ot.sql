-- ============================================================
-- SdG — El pedido de Compras recuerda de qué OT nació
--
-- POR QUÉ EXISTE
--
-- Cuando alguien pide un repuesto desde una OT, el formulario de Compras se
-- abre precargado y la ruta `POST /api/compras/requerimientos` crea el RI y
-- devuelve su número. Ese vínculo —«este pedido nació de esta OT, de este
-- renglón»— se sabe en el momento y se tira: para dejar constancia, una persona
-- tiene que tipear ese mismo número a mano en `mant_ri_de_repuesto`. Por eso la
-- tabla tiene 0 filas (medido el 23/11/2026) y por eso la ficha de un RI no puede
-- decir para qué se pidió.
--
-- Estas dos columnas hacen que el pedido se acuerde solo, en su propia fila y en
-- el mismo `insert` que lo crea: o se guarda todo o no se guarda nada.
--
-- POR QUÉ NO VA EN `mant_ri_de_repuesto`
--
-- Esa tabla responde otra pregunta: «¿qué parte de lo que falta ya está
-- cubierta?», y es plural a propósito. Cuando el renglón de la OT tiene
-- `articulo_id`, el RI se pega **al artículo** y vale para todas las órdenes
-- abiertas que piden esa pieza, así que de esa fila no se puede sacar de qué OT
-- nació el pedido. Hoy no se nota porque los 37 renglones de
-- `ordenes_trabajo_repuestos` tienen 0 `articulo_id`; se rompería callado el día
-- que alguien elija uno, que es justo lo que el módulo empuja a hacer. «¿De qué
-- OT nació este pedido?» tiene una sola respuesta y tiene que vivir donde nace.
--
-- Además la ruta de ese puente pide permiso de edición de Mantenimiento, y el
-- botón «Pedir a Compras» no lo pide a propósito (un requerimiento lo puede
-- generar cualquier usuario). Escribirlo desde la misma ruta que crea el RI no
-- cruza ningún permiso.
--
-- `on delete set null` Y NO CASCADA, EN LAS DOS
--
-- Mantenimiento borra OT cuando la planilla las deja de traer
-- (`borrarLoQueLaPlanillaNoTrajo`), y esa cascada ya se lleva los renglones de
-- repuesto. Si acá fuera `cascade`, borrar una OT se llevaría un requerimiento de
-- compra, que es plata y vive en otro módulo. El RI sigue siendo un RI: sólo
-- deja de saber de dónde vino. Guardar el número suelto de una orden que ya no
-- existe no es información.
--
-- EL ÍNDICE ES PARCIAL Y NO SIRVE DE DESTINO DE UN `ON CONFLICT`
--
-- El índice de `ot_id` es `where ot_id is not null`: existe sólo para poder
-- preguntar «¿qué pidió esta OT?» sin recorrer las ~2.350 filas, y la mayoría de
-- los pedidos no nacen de una OT. **No se usa, ni se debe usar, como destino de
-- un `ON CONFLICT`**: un índice parcial no lo es y el `upsert` falla con `42P10`
-- recién la primera vez que se ejecuta (segunda trampa del README, ya pisada tres
-- veces). No es una clave única de nada: una OT puede pedir muchos RI.
--
-- LA PLANILLA NO TIENE ESTAS COLUMNAS
--
-- `compras_requerimientos` espeja una planilla y la sincronización la rearma
-- desde ella. Estas dos columnas no existen allá: sobreviven sólo si el
-- constructor de la fila las conserva (`fusionDeLaPlanilla`, patrón
-- `previo?.campo ?? null`, como `equipo_raw`). Eso va en el código y no acá, pero
-- sin esa línea la primera sincronización las borra.
--
-- A TENER EN CUENTA
--
-- · Se puede correr dos veces: todo con `if not exists`.
-- · Es DDL y lo corre una persona a mano en el editor SQL de Supabase. Hasta que
--   esté aplicada, ningún `select()` del código puede nombrar estas columnas: el
--   deploy es automático y el SQL no, y nombrarlas rompe lo que ya anda.
-- · Suma un segundo camino entre `compras_requerimientos` y `ordenes_trabajo`, y
--   otro hacia `ordenes_trabajo_repuestos`: todo embed que cruce esas tablas
--   tiene que nombrar el FK (`PGRST201`). Ninguno existe todavía.
-- · Una migración aplicada no se edita: si hay que cambiar algo, va otra.
-- ============================================================

alter table public.compras_requerimientos
  add column if not exists ot_id uuid
  references public.ordenes_trabajo(id) on delete set null;

alter table public.compras_requerimientos
  add column if not exists ot_repuesto_id uuid
  references public.ordenes_trabajo_repuestos(id) on delete set null;

-- Parcial a propósito: ver «El índice es parcial». No es destino de ON CONFLICT.
create index if not exists compras_requerimientos_ot_id_idx
  on public.compras_requerimientos (ot_id)
  where ot_id is not null;

comment on column public.compras_requerimientos.ot_id is
  'Orden de trabajo de la que nació el pedido (la intención: «se pidió para»), si nació de un repuesto de una OT. Null quiere decir que no nació de ninguna, nunca que no se sepa. No prueba que el material se haya aplicado ahí. on delete set null: borrar la OT no se lleva el requerimiento.';

comment on column public.compras_requerimientos.ot_repuesto_id is
  'Renglón de repuesto de la OT desde el que se abrió el pedido. on delete set null por la misma razón que ot_id.';
