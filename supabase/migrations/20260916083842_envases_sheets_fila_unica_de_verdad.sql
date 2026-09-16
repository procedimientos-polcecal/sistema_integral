-- ============================================================
-- SdG — Envases: la fila de la planilla, única de verdad
--
-- La sincronización de envases iba a fallar con "there is no unique or
-- exclusion constraint matching the ON CONFLICT specification" (42P10) y no
-- habría entrado ningún movimiento.
--
-- La causa es la migración de las tablas de envases, que creó el índice así:
--
--   create unique index produccion_envases_mov_sheets_fila_idx
--     on produccion_envases_movimientos (sheets_fila) where sheets_fila is not null;
--
-- **Postgres no acepta un índice parcial como destino de `ON CONFLICT`.**
--
-- Es la TERCERA vez en esta base, con la misma frase: la 034 lo dejó escrito
-- cuando el mismo error hizo fallar la importación del libro de equipos, la 049
-- lo volvió a escribir cuando rompió el kardex del almacén, y acá se repitió
-- porque el diseño de envases copió el DDL de Inventario **anterior** a su
-- propio arreglo. La trampa está en el README de migraciones y aun así se cuela:
-- lo que la deja pasar es que el error no aparece al crear el índice sino
-- recién en el primer upsert.
--
-- Medido antes de escribir esto, contra la base real: un upsert de prueba con
-- `on_conflict=sheets_fila` devolvió 42P10 las dos veces y no insertó nada.
--
-- La misma solución que la 049: un índice único común hace el trabajo sin el
-- problema, porque **en Postgres los nulos no chocan entre sí**. Los
-- movimientos cargados desde la app tienen `sheets_fila` en null hasta que el
-- espejo escribe, y varios en null conviven sin pisarse.
-- ============================================================

drop index if exists produccion_envases_mov_sheets_fila_idx;

create unique index if not exists produccion_envases_mov_sheets_fila_idx
  on produccion_envases_movimientos (sheets_fila);

comment on column produccion_envases_movimientos.sheets_fila is
  'En qué fila del kardex quedó. Único: una fila de la planilla es un movimiento y uno solo, y es lo que hace que reimportar no duplique. Null mientras el espejo no haya escrito, y los nulos no chocan entre sí.';
