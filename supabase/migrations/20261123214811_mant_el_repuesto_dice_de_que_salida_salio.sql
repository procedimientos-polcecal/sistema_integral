-- ============================================================
-- SdG — El renglón de repuesto de una OT dice de qué salida del pañol salió
--
-- POR QUÉ EXISTE
--
-- Hoy un renglón de `ordenes_trabajo_repuestos` dice qué repuesto se pidió y
-- cuántos, pero no si ese repuesto se aplicó de verdad. Pedir no es usar: lo
-- único que prueba que una pieza fue a esa orden es la salida del pañol, que
-- vive en `inventario_movimientos`. Estas tres columnas dejan que una persona
-- diga «este renglón se cumplió con esta salida» y que quede quién lo dijo y
-- cuándo. Es la mitad B de la trazabilidad del repuesto; la mitad A (el RI
-- recuerda de qué OT nació, migración `20261123212344`) dice la intención, y ésta
-- dice el hecho.
--
-- POR QUÉ EL VÍNCULO VIVE ACÁ Y NO EN `inventario_movimientos`
--
-- La responsabilidad es de Mantenimiento: es quien afirma «esta salida fue para
-- mi renglón». Y el renglón puede saber qué artículo declaró (`articulo_id`), así
-- que un vínculo que quedó mal —el movimiento es de otro artículo— **se detecta
-- comparando los dos lados**. Ojo: eso sólo funciona cuando el renglón tiene
-- `articulo_id`, y hoy son 0 de 37 (abajo); mientras no lo tenga, el vínculo no
-- se puede contrastar contra nada. Del otro lado, en una tabla del núcleo de
-- Inventario que lee todo el sistema, un `ot_renglon_id` sería una columna que
-- Inventario no sabe interpretar y que ninguna de sus pantallas valida.
--
-- Medido contra producción el 23/11/2026: `ordenes_trabajo_repuestos` tiene 7
-- columnas —`articulo_id, cantidad, codigo, created_at, id, nombre,
-- work_order_id`— y **0 de 37 renglones** tienen `articulo_id`. O sea que
-- todavía nadie enlazó un renglón con un artículo del pañol: estas columnas
-- nacen sobre una tabla sin ningún vínculo previo y no hay nada que migrar.
--
-- QUÉ DEMUESTRA LA MEDICIÓN DEL KARDEX (Y QUÉ NO)
--
-- El kardex de Inventario tiene **5.136 filas** y **cero retrocesos de fecha**
-- (medido el 23/11/2026): el orden cronológico es confiable, se agrega al final.
-- Eso **no** es lo que mantiene firme al vínculo: una FK identifica la fila por
-- su id, no por posición ni por fecha, así que ningún reordenamiento puede
-- redirigirla. Lo que sí la rompería es borrar el movimiento, y de eso se ocupa
-- `on delete set null`. Lo que la medición sostiene es otra cosa: el código que
-- sigue razona por fecha —lista como candidatas «las salidas posteriores a la
-- entrada»— y eso sólo tiene sentido si la fecha ordena de verdad.
--
-- `on delete set null` Y NO CASCADA NI RESTRICT
--
-- El renglón de la OT sobrevive al movimiento de inventario, igual que en la
-- mitad A el RI sobrevive a la OT. Borrar el renglón junto con el movimiento se
-- llevaría el registro de qué se pidió, que es información de Mantenimiento; y
-- bloquear el borrado dejaría a Inventario sin poder corregir su libro. Hoy
-- nada borra movimientos (la sincronización de Inventario sólo hace `upsert`),
-- así que es una defensa y no un caso observado. Tiene precedente:
-- `taller_vial_repuestos_asignados.movimiento_id` (migración
-- `20260917105422`) es igual.
--
-- **Consecuencia para el código:** al anularse `movimiento_id`,
-- `movimiento_puesto_por` y `movimiento_puesto_en` quedan con datos, y el
-- renglón diría «alguien lo vinculó tal día» sin movimiento. El código tiene que
-- tratar `movimiento_id is null` como «sin vínculo» e ignorar los dos `puesto_*`.
--
-- `movimiento_puesto_por` NO LLEVA `on delete set null`, A PROPÓSITO
--
-- Es lo que decidió el plan
-- (`docs/superpowers/plans/2026-11-23-compras-trazabilidad-del-repuesto.md`,
-- Tarea 6) y se deja tal cual: borrar a una persona con vínculos puestos se
-- niega. Suponemos —sin medirlo— que los usuarios se desactivan y no se borran;
-- si algún día se los borra, esta columna lo frena y habrá que decidir si se
-- anula o se archiva, porque «quién lo dijo» es el dato que no conviene perder.
--
-- NO HAY POLICY NUEVA
--
-- Las columnas viven en una tabla que ya tiene las suyas (detrás de
-- `mant_puede_ver()`), y una policy de Postgres es por fila y no por columna: las
-- nuevas heredan lo que ya rige. Escribirlas pide lo que ya pide editar los
-- renglones de una OT.
--
-- EL ÍNDICE ES PARCIAL Y NO SIRVE DE DESTINO DE UN `ON CONFLICT`
--
-- `where movimiento_id is not null` es para **consultar** («¿qué renglones se
-- cumplieron con esta salida?»); hoy los 37 renglones tienen null. Nada hace
-- `upsert` contra `movimiento_id` ni debe hacerlo: no es clave única de nada y un
-- índice parcial no vale como destino de `ON CONFLICT` (`42P10`, segunda trampa
-- del README).
--
-- A TENER EN CUENTA
--
-- · Se puede correr dos veces: todo con `if not exists`.
-- · Es DDL y lo corre una persona a mano en el editor SQL de Supabase. Hasta que
--   esté aplicada, ningún `select()` del código puede nombrar estas columnas: el
--   deploy es automático y el SQL no, y nombrarlas rompe lo que ya anda.
-- · El Asistente conoce `ordenes_trabajo_repuestos` por su catálogo commiteado
--   (`lib/asistente/catalogo.generado.json`): queda ciego a estas columnas hasta
--   que alguien corra `npm run catalogo`. Va después de aplicar la migración.
-- · Una migración aplicada no se edita: si hay que cambiar algo, va otra.
-- ============================================================

alter table public.ordenes_trabajo_repuestos
  add column if not exists movimiento_id uuid
  references public.inventario_movimientos(id) on delete set null,
  add column if not exists movimiento_puesto_por uuid
  references public.usuarios(id),
  add column if not exists movimiento_puesto_en timestamptz;

-- Parcial a propósito: ver «El índice es parcial». No es destino de ON CONFLICT.
create index if not exists ordenes_trabajo_repuestos_movimiento_id_idx
  on public.ordenes_trabajo_repuestos (movimiento_id)
  where movimiento_id is not null;

comment on column public.ordenes_trabajo_repuestos.movimiento_id is
  'Salida del pañol (inventario_movimientos) con la que se cumplió este renglón: el hecho, no la intención. Null quiere decir que nadie lo vinculó, no que no se haya usado. on delete set null: si el movimiento desaparece el renglón sobrevive.';

comment on column public.ordenes_trabajo_repuestos.movimiento_puesto_por is
  'Quién vinculó el renglón con la salida del pañol. Sin on delete set null a propósito: «quién lo dijo» no se pierde en silencio.';

comment on column public.ordenes_trabajo_repuestos.movimiento_puesto_en is
  'Cuándo se vinculó el renglón con la salida del pañol.';
