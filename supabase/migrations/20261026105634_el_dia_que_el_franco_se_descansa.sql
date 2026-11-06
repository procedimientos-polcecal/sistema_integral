-- ============================================================
-- SdG — El dia que el franco se descansa
--
-- QUÉ PROBLEMA RESUELVE
--
-- `francos.fecha_tomado` no es el día que la persona descansó: es el día en que
-- alguien apretó el botón "marcar tomado" en `/rrhh/francos`, porque la pantalla
-- mandaba `hoyEnArgentina()` a mano. Medido en producción el 23/10/2026: de 217
-- francos, 56 están TOMADO y sus `fecha_tomado` caen en **tres fechas** — 35 el
-- 01/09/2026, 20 el 16/09/2026 y uno el 19/10/2026. No son tres días en que
-- descansó medio taller: son tres sesiones de alguien poniéndose al día.
--
-- Eso dejó a la programación semanal del taller sin poder cruzar los francos.
-- Un franco tomado es un día que la persona no viene, igual que una ausencia,
-- pero cruzarlo por `fecha_tomado` habría pintado 35 huecos un lunes cualquiera
-- — que es justo el anti-objetivo de esa pantalla: que mienta sobre quién está.
-- Por eso `francos` quedó explícitamente afuera del cruce, y así está escrito
-- en el spec `2026-10-22-mantenimiento-disponibilidad-y-turnos-design.md`.
--
-- QUÉ SE DECIDIÓ, Y POR QUÉ UNA COLUMNA NUEVA Y NO ARREGLAR LA VIEJA
--
-- El franco se marca **cuando se formaliza**, y en ese momento el día de
-- descanso ya se sabe: casi siempre está adelante. O sea que el dato existe y
-- lo único que faltaba era pedirlo en vez de adivinarlo.
--
-- Se agrega `fecha_descanso` en vez de reinterpretar `fecha_tomado`, por dos
-- motivos:
--
--   1. **Las 56 filas viejas no se pueden recuperar** — su día real no quedó
--      registrado en ningún lado, y así lo decidió el usuario: se dan por
--      perdidas y se dejan como están. Si el día real se escribiera en la misma
--      columna, esas 56 quedarían indistinguibles de las nuevas y el cruce las
--      creería. Con una columna nueva quedan en NULL, que es la verdad: el
--      sistema no sabe cuándo descansaron. Es la misma regla que el proyecto ya
--      aplica con las planillas — **enlazar al que se le parece es peor que
--      dejar en null**.
--   2. `fecha_tomado` pasa a significar algo honesto —cuándo se formalizó— en
--      vez de ser una fecha que miente sobre otra cosa.
--
-- QUÉ NO CAMBIA
--
-- Nada se reescribe: esto sólo agrega una columna. Y `fecha_tomado` se usa hoy
-- en **un solo lugar** —la columna del CSV de `/api/rrhh/francos/export`—;
-- ningún cálculo depende de ella. La liquidación no la mira: `planillaGeneral`
-- suma las horas del franco por `fecha_generado` y sin mirar el estado, así que
-- para el sueldo el franco pesa cuando se gana y no cuando se descansa. Esto no
-- toca eso.
-- ============================================================

alter table francos
  add column if not exists fecha_descanso date;

comment on column francos.fecha_descanso is
  'El día que la persona efectivamente descansa este franco, cargado por quien '
  'lo marca tomado —que es cuando se formaliza, así que el día ya se sabe y '
  'suele estar adelante—. NULL en los 56 francos marcados antes del 26/10/2026: '
  'su día real nunca se registró y no se puede reconstruir. La programación del '
  'taller cruza esta columna y no `fecha_tomado`, que es la fecha del trámite.';

comment on column francos.fecha_tomado is
  'Cuándo se marcó el franco como tomado: la fecha del trámite, no la del '
  'descanso. Para el día de descanso está `fecha_descanso`. Hasta el 26/10/2026 '
  'la pantalla escribía acá `hoy` y no había otra columna, y por eso los 56 '
  'francos tomados de antes caen en sólo tres fechas.';
