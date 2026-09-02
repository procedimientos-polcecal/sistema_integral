-- ============================================================
-- SdG — La fila de la planilla, única de verdad
--
-- La sincronización del almacén falla con "there is no unique or exclusion
-- constraint matching the ON CONFLICT specification" y no entra ningún
-- movimiento.
--
-- La causa es la 046, que creó el índice así:
--
--   create unique index inventario_mov_sheets_fila_idx
--     on inventario_movimientos (sheets_fila) where sheets_fila is not null;
--
-- **Postgres no acepta un índice parcial como destino de `ON CONFLICT`.** Es
-- exactamente lo que la migración 034 ya dejó escrito, palabra por palabra,
-- cuando el mismo error hizo fallar la importación del libro de equipos: "la
-- 033 lo hizo único sólo cuando no es nulo, para no obligar a los sectores
-- organizativos a tener uno. Pero Postgres no acepta un índice parcial como
-- destino de ON CONFLICT, así que la importación fallaba en el primer sector".
--
-- La misma lección, en la misma base, dos meses después. Y la misma solución:
-- un índice único común hace el trabajo sin el problema, porque **en Postgres
-- los nulos no chocan entre sí**. Los movimientos cargados desde la app tienen
-- `sheets_fila` en null hasta que el espejo escribe, y varios en null conviven
-- sin pisarse.
-- ============================================================

drop index if exists inventario_mov_sheets_fila_idx;

create unique index if not exists inventario_mov_sheets_fila_idx
  on inventario_movimientos (sheets_fila);

comment on column inventario_movimientos.sheets_fila is
  'En qué fila del kardex quedó. Único: una fila de la planilla es un movimiento y uno solo, y es lo que hace que reimportar no duplique. Null mientras el espejo no haya escrito.';
