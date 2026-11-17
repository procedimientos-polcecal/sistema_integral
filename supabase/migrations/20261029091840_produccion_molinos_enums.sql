-- ============================================================
-- SdG — Producción: los enums de los molinos, solos
--
-- Son los tipos que usa la tabla de turnos de los molinos (tarea 2 del plan),
-- y viajan en su propio archivo para que esa tabla y sus policies vayan en otro,
-- ya aplicado este. Ver docs/superpowers/specs/2026-10-21-produccion-molinos-desde-el-robot-design.md.
--
-- Los cuatro turnos se nombran por el intervalo que cubren, y el sello de hora
-- del robot es el cierre de cada uno:
--   20_00  cubre 20 → 00, cierra 23:59, duración teórica 240 min
--   00_04  cubre 00 → 04, cierra 3:59,  duración teórica 240 min
--   04_12  cubre 04 → 12, cierra 11:59, duración teórica 480 min
--   12_20  cubre 12 → 20, cierra 19:59, duración teórica 480 min
-- El turno lo decide la hora de cierre, nunca la posición de la columna.
--
-- Por qué no reusan produccion_turno: ese tiene dos valores, '4_12' y '12_20',
-- que caen en las mismas horas de reloj que los de acá, pero miden otra cosa.
-- El parte de fábrica cuenta producto terminado; el robot cuenta lo que entra
-- al molino. Son cosas que no se suman, así que no comparten tipo aunque el
-- horario coincida. Y los turnos 20_00 y 00_04 sólo existen acá: el parte no
-- registra esas ocho horas.
--
-- Sobre el orden: un valor agregado con alter type ... add value no se puede
-- usar en la misma transacción que lo agregó (55P04). Acá no hay ningún alter
-- type: los dos tipos se crean de cero, así que este archivo sólo los define.
-- Lo que los use va en el siguiente.
-- ============================================================

create type produccion_molino_turno as enum ('20_00', '00_04', '04_12', '12_20');
create type produccion_molino_estado as enum ('normal', 'acumulado', 'inconsistente', 'huerfano');
