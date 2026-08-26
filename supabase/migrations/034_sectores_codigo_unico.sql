-- ============================================================
-- SdG — El código de sector, único de verdad
--
-- La migración 033 lo hizo único **sólo cuando no es nulo**, para no obligar a
-- los sectores organizativos a tener uno. Pero Postgres no acepta un índice
-- parcial como destino de `ON CONFLICT`, así que la importación del libro
-- fallaba en el primer sector con "there is no unique or exclusion constraint
-- matching the ON CONFLICT specification" — y sin sectores no se creaba ningún
-- equipo.
--
-- Un índice único común hace lo mismo sin el problema: en Postgres los nulos no
-- chocan entre sí, así que los 26 sectores sin código siguen conviviendo.
-- ============================================================

drop index if exists sectores_codigo_idx;

create unique index if not exists sectores_codigo_idx
  on sectores (codigo);
