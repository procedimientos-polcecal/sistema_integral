-- ============================================================
-- SdG — La fecha de un movimiento del almacén puede faltar
--
-- La sincronización falla con:
--
--   null value in column "fecha" of relation "inventario_movimientos"
--   violates not-null constraint
--
-- La 046 declaró `fecha timestamptz not null default now()`, copiando el
-- esquema del repo de origen. Pero el kardex de la planilla tiene filas sin
-- fecha —el parser lo contempla a propósito y hay un test que lo fija: "sin
-- fecha el movimiento existe igual"—, y un movimiento sin fecha es un
-- movimiento igual: se retiró algo y quedó anotado, sólo que nadie escribió
-- cuándo.
--
-- La tentación es omitir la columna al insertar para que caiga el `default
-- now()`. Sería peor que el error: le pondría **la fecha de hoy** a un
-- movimiento que pasó vaya a saber cuándo, y esa mentira después se suma en los
-- reportes por período sin que nada la señale. Es la misma regla que el resto
-- del sistema aplica con el stock: vacío no es cero, y "no se sabe cuándo" no es
-- "hoy".
--
-- El default se conserva, y hace falta: los movimientos que se cargan desde la
-- app no pasan `fecha` y ahí `now()` **sí** es la verdad —se está registrando en
-- el momento—. Con la columna nullable conviven las dos cosas: quien no la pasa
-- recibe el default, y quien la pasa en null está diciendo que la planilla no la
-- trae.
--
-- Las pantallas ya lo trataban así: el kardex muestra "—", el bloque del
-- requerimiento dice "sin fecha", y el orden usa `nullsFirst: false`.
-- ============================================================

alter table inventario_movimientos
  alter column fecha drop not null;

comment on column inventario_movimientos.fecha is
  'Cuándo se movió. NULL cuando el kardex de la planilla no lo dice: es "no se sabe", no "hoy". Los movimientos cargados en la app no la pasan y toman el default now(), que ahí sí es la verdad.';

-- ── Y el origen deja de pisarse a sí mismo ───────────────────
--
-- Segundo problema, y este aparece recién en la SEGUNDA sincronización.
--
-- Un movimiento cargado en la app se espeja al kardex y queda con su
-- `sheets_fila`. La sincronización siguiente lee esa misma fila y hace upsert
-- sobre ella con `origen = 'planilla'`, pisando el `'app'` original. O sea que
-- todo lo cargado en el sistema terminaba figurando como venido de la planilla
-- —justo el campo que existe para saber si la app se está usando—.
--
-- La solución es que la sincronización **no mande `origen`**: en un upsert, las
-- columnas que no viajan no entran en el `SET`, así que una fila que ya existe
-- conserva el suyo. Para que las filas nuevas del kardex igual queden bien, el
-- default pasa de 'app' a 'planilla'.
--
-- Queda al revés de lo que uno esperaría —el default es el caso "de afuera"— y
-- es a propósito: el único que inserta con origen 'app' es el RPC, que lo pone
-- explícito. Cualquier otro camino que se olvide de ponerlo está, casi seguro,
-- copiando de la planilla.

alter table inventario_movimientos
  alter column origen set default 'planilla';

comment on column inventario_movimientos.origen is
  'app = lo cargó alguien en el SdG (lo pone el RPC, explícito). planilla = vino del kardex, y es el default. La sincronización no manda esta columna a propósito: así no pisa el origen de un movimiento que ya existía.';
