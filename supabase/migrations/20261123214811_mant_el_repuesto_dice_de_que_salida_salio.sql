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
-- mi renglón». Y el renglón sabe qué artículo declaró (`articulo_id`), así que un
-- vínculo que quedó mal —el movimiento es de otro artículo, o se mudó— **se
-- detecta comparando los dos lados**. Del otro lado, en una tabla del núcleo de
-- Inventario que lee todo el sistema, un `ot_renglon_id` sería una columna que
-- Inventario no sabe interpretar y que ninguna de sus pantallas valida.
--
-- Medido contra producción el 23/11/2026: `ordenes_trabajo_repuestos` tiene 7
-- columnas —`articulo_id, cantidad, codigo, created_at, id, nombre,
-- work_order_id`— y **0 de 37 renglones** tienen `articulo_id`. O sea que
-- todavía nadie enlazó un renglón con un artículo del pañol: estas columnas
-- nacen sobre una tabla sin ningún vínculo previo y no hay nada que migrar.
--
-- POR QUÉ APUNTAR A UN MOVIMIENTO ES SEGURO
--
-- Un `uuid` que apunta a una fila sólo vale si esa fila no se mueve ni se
-- reescribe. El kardex de Inventario tiene **5.136 filas** y **cero retrocesos de
-- fecha** (medido el 23/11/2026): se agrega siempre al final, nunca en el medio,
-- y un movimiento ya asentado no cambia de lugar. Si eso dejara de ser cierto,
-- el vínculo apuntaría a una salida distinta de la que se eligió sin dar error.
--
-- `on delete set null` Y NO CASCADA NI RESTRICT
--
-- El renglón de la OT sobrevive al movimiento de inventario, igual que en la
-- mitad A el RI sobrevive a la OT. Si el movimiento desaparece (una corrección
-- del kardex, una planilla que lo deja de traer), borrar el renglón se llevaría
-- el registro de qué se pidió, que es información de Mantenimiento y no de
-- Inventario; y bloquear el borrado dejaría a Inventario sin poder corregir su
-- propio libro. El renglón sólo deja de saber de qué salida salió.
--
-- `movimiento_puesto_por` NO LLEVA `on delete set null`, A PROPÓSITO
--
-- Es la decisión del plan y se deja tal cual: la referencia a `usuarios` es la
-- estándar y borrar a una persona con vínculos puestos se niega. Los usuarios del
-- sistema se desactivan, no se borran. Lo que sí hay que saber: si algún día se
-- permite borrarlos, esta columna lo va a frenar y habrá que decidir si se anula
-- o se archiva, porque «quién lo dijo» es justo el dato que no conviene perder.
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
-- `where movimiento_id is not null` es para **consultar**: la ficha de un RI
-- pregunta «¿qué renglones de OT se cumplieron con esta salida?» y la gran
-- mayoría de los renglones —hoy los 37— no tienen ninguna. **Nada hace `upsert`
-- contra `movimiento_id` ni debe hacerlo**: no es clave única de nada (una salida
-- puede cubrir varios renglones) y un índice parcial no vale como destino de
-- `ON CONFLICT`, que falla con `42P10` recién la primera vez que se ejecuta
-- (segunda trampa del README, ya pisada tres veces). No es el mismo error: acá
-- no se pretende que sirva para eso.
--
-- A TENER EN CUENTA
--
-- · Se puede correr dos veces: todo con `if not exists`.
-- · Es DDL y lo corre una persona a mano en el editor SQL de Supabase. Hasta que
--   esté aplicada, ningún `select()` del código puede nombrar estas columnas: el
--   deploy es automático y el SQL no, y nombrarlas rompe lo que ya anda.
-- · `ordenes_trabajo_repuestos` ya tiene un camino hacia `inventario_*` por
--   `articulo_id`; esta columna agrega un segundo hacia `inventario_movimientos`
--   y otro de `usuarios` a la tabla: todo embed que cruce esas tablas tiene que
--   nombrar el FK (`PGRST201`). Ninguno existe todavía.
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
