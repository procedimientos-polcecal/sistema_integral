-- ============================================================
-- SdG — El vistazo anterior de los avisos
--
-- POR QUÉ HACE FALTA
--
-- El resumen diario de las 8:30 llega una vez por día, así que una ausencia
-- que alguien carga a las 9:05 se cuenta recién a la mañana siguiente. Se pidió
-- que las ausencias y las novedades avisen **enseguida**, y «enseguida» es un
-- cron que corre cada quince minutos y manda lo que cambió desde la corrida
-- anterior. Esta tabla es ese «desde la corrida anterior».
--
-- POR QUÉ ES OTRA TABLA Y NO `avisos_fotos`
--
-- Son dos relojes distintos y mezclarlos rompe uno de los dos:
--
--   - `avisos_fotos` tiene una fila por aviso **y por día**, y su clave
--     `(fecha, notificacion_id)` es además la idempotencia del cron diario: si
--     corre dos veces el mismo día, la segunda compara contra la foto de hoy y
--     da cero. Los lunes el resumen calcula los totales contra ella.
--   - Ésta tiene **una sola fila por aviso**, sin fecha en la clave, y se pisa
--     unas 56 veces por día.
--
-- Si el instantáneo escribiera en `avisos_fotos`, la foto de hoy quedaría
-- pisada a las 7:15 con los números de las 7:15 y el delta del día siguiente
-- se mediría contra eso en vez de contra el cierre del día. Y al revés: si el
-- instantáneo leyera la foto diaria, compararía contra ayer y mandaría el
-- movimiento del día entero en cada pasada.
--
-- POR QUÉ EL BORRADO IMPORTA, Y NO ES UN DETALLE DE IMPLEMENTACIÓN
--
-- La `cantidad` de un `salud-*` es la racha de corridas fallidas, no una
-- cantidad de cosas, así que esa familia se avisa **por el flanco**: cuando
-- aparece, una vez, y no cada vez que la racha sube. El flanco se decide
-- preguntando si el id **estaba** en esta tabla.
--
-- O sea que un recurso que se arregla tiene que **salir de la tabla**, o el día
-- que vuelva a romperse ya figuraría como visto y no se avisaría nunca más. Por
-- eso el guardado reemplaza el contenido entero —borra lo que ya no está y
-- escribe lo de ahora— en vez de hacer sólo `upsert`. Un `upsert` sin borrado
-- deja las filas viejas para siempre y rompe el flanco en silencio: nada falla,
-- simplemente deja de avisar.
--
-- `visto_en` va **en cada fila** y no en una tabla aparte porque la pregunta
-- que se le hace es siempre «¿cuándo fue la corrida anterior?», y todas las
-- filas se escriben juntas. Con la tabla vacía hace falta igual una fila
-- centinela para no perder esa hora — el mismo patrón que `SIN_AVISOS` en
-- `lib/home/fotoDeAvisos.ts`, y por el mismo motivo: sin ella, una corrida sin
-- ningún aviso dejaría la hora quieta y la siguiente volvería a comparar contra
-- un rato más viejo.
--
-- `notificacion_id` es texto y no un enum, por lo mismo que en `avisos_fotos`:
-- los ids los define `lib/home/avisos.ts` y cambian con cada módulo nuevo. Un
-- enum pediría una migración por aviso, y un valor de enum nuevo además viaja
-- solo en su propio archivo (55P04).
--
-- RLS PRENDIDO Y NINGUNA POLICY — deliberado, no un olvido, igual que
-- `avisos_fotos`. La escribe y la lee **sólo el cliente admin**, desde el cron
-- del aviso al instante. Ninguna pantalla la muestra: la campana lee los
-- conteos de vivo. Con RLS prendido y sin policies, PostgREST le niega todo a
-- cualquier autenticado y el cliente admin pasa de largo. Sin el `enable`, la
-- tabla quedaría abierta a cualquiera con sesión. Si alguien le agrega una
-- policy «para poder mirarla», está abriendo lo que esto cerró.
-- ============================================================

create table if not exists public.avisos_vistos (
  -- Sin fecha en la clave, a propósito: hay una sola fila por aviso y la pisa
  -- cada corrida. La historia la guarda `avisos_fotos`, que es la otra tabla.
  notificacion_id text primary key,
  cantidad integer not null,
  -- La hora de la corrida que escribió esta fila. Se repite en todas las filas
  -- porque se escriben juntas, y es lo que contesta «¿cuándo fue la anterior?».
  visto_en timestamptz not null
);

alter table public.avisos_vistos enable row level security;
