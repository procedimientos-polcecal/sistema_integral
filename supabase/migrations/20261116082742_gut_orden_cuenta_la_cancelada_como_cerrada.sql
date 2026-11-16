-- ============================================================
-- SdG — Mantenimiento: `gut_orden` cuenta la CANCELADA como cerrada
--
-- Una OT cancelada es una orden que no se va a hacer nunca (el diseño y el plan
-- están en docs/superpowers/specs y docs/superpowers/plans, «cancelar una OT»).
-- Entra al vocabulario de los estados en reemplazo de SUSPENDIDA, y la columna
-- generada `gut_orden` —la clave con la que el tablero GUT ordena— tiene los
-- estados cerrados escritos adentro. Hay que cambiarlos ahí.
--
-- ── POR QUÉ ESTA MIGRACIÓN Y NO UN `alter` ───────────────────────────────────
--
-- Una columna generada **no se altera en su lugar**: Postgres no deja cambiar la
-- expresión de una `generated always as ... stored` (hay `drop expression`, pero
-- sólo la convierte en una columna común). El único camino es dropearla y
-- rehacerla. Y el `drop column` se lleva el índice que la usaba, así que
-- `ordenes_trabajo_gut_orden_idx` se vuelve a crear al final.
--
-- Tampoco se edita la `20261021104750`, que fue la que la creó: una migración
-- aplicada no se edita, se corrige con otra. Esta es esa otra.
--
-- Rehacerla recalcula las 2.453 filas de la tabla (una reescritura de tabla):
-- es chica y la corre una persona a mano, así que se espera lo que tarde.
--
-- ── QUÉ CAMBIA, Y QUÉ NO ─────────────────────────────────────────────────────
--
-- Cambia una cosa: `('REALIZADO', 'SUSPENDIDA')` pasa a `('REALIZADO',
-- 'CANCELADA')`. SUSPENDIDA sale porque no tiene filas: medido el 13/11/2026,
-- 0 de 2.453 órdenes. Sacarla no mueve ninguna fila de lugar.
--
-- No cambia el 27 de las órdenes sin puntaje (`coalesce(..., 27)`). Se conserva
-- tal cual porque está escrito también en `lib/mantenimiento/gut.ts`
-- (`SIN_PUNTAJE`), con un test que los ata. Cambiar uno sin el otro es lo que
-- el encabezado de la 20261021104750 ya advertía.
--
-- Y la lista de acá tiene que decir lo mismo que `CERRADAS_GUT`, en ese mismo
-- archivo: `["REALIZADO", "CANCELADA"]`. No hay test que lea este SQL; lo que
-- las ata es el test literal de `gut.test.ts` y mirar las dos juntas.
--
-- ── MIENTRAS NO SE APLIQUE ───────────────────────────────────────────────────
--
-- El TypeScript ya dice que una cancelada está cerrada, pero la base no: una
-- orden cancelada cae en el `else`, cuenta como abierta y suma el +1000.
--
-- Y eso no se queda en un tablero aparte, porque `gut_orden` **es el orden por
-- defecto del listado entero de OT**: `app/api/mantenimiento/ordenes/route.ts`
-- cae en `.order("gut_orden", …)` para cualquier `?orden=` que no sea
-- `numero`, y `lib/mantenimiento/filtrosOt.ts` lo documenta como el sugerido.
-- Así que hasta que alguien corra esta migración en el editor SQL de Supabase,
-- **una orden recién cancelada se queda ordenada entre las abiertas en
-- `/mantenimiento/ordenes`**, con su +1000 y su puntaje: sube en vez de
-- correrse al final, que es lo contrario de lo que espera quien la acaba de
-- cancelar. El Asistente ordena por la misma columna (`lib/asistente/notas.ts`),
-- así que ahí se ve igual.
--
-- No se pierde nada mientras tanto —el filtro por estado sigue sacándolas, y
-- `claveDeOrdenGut` en TypeScript ya da 27— pero está en el lugar equivocado,
-- y ése es justo el ruido que este estado venía a sacar del tablero.
--
-- ── LO QUE NO HACE FALTA ─────────────────────────────────────────────────────
--
-- Policy nueva: no, no hay tabla nueva. `ordenes_trabajo` conserva las suyas.
-- Ninguna vista ni trigger depende de `gut_orden` (se buscó en las migraciones:
-- sólo la nombran comentarios), así que el `drop` no arrastra nada más.
-- El catálogo del Asistente: la columna sigue llamándose igual y es del mismo
-- tipo, no hay nada que regenerar.
--
-- Se puede correr dos veces: `drop column if exists`, `add column if not
-- exists` y `create index if not exists`. En la segunda corrida rehace la
-- columna con la misma expresión, sin efecto visible.
-- ============================================================

alter table ordenes_trabajo drop column if exists gut_orden;

alter table ordenes_trabajo
  add column if not exists gut_orden integer generated always as (
    (case when estado in ('REALIZADO', 'CANCELADA') then 0 else 1000 end)
    + coalesce(gut_gravedad * gut_urgencia * gut_tendencia, 27)
  ) stored;

create index if not exists ordenes_trabajo_gut_orden_idx
  on ordenes_trabajo (gut_orden desc, ot_number desc);
