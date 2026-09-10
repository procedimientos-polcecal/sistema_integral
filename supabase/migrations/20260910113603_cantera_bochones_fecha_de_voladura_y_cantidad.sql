-- ============================================================
-- SdG — Cantera: el bochón lleva fecha de voladura y cantidad
--
-- De la revisión del usuario (10/09/2026). El editor de bochones tiene que
-- dejar cargar, además del código y la voladura asociada:
--
--   - `fecha_voladura`: cuándo se disparó el bochón (la secundaria). El schema
--     sólo tenía `inicio` / `fin`, que son las fechas de perforación.
--   - `cantidad`: cuántos bochones agrupa ese registro. La columna se llamaba
--     `pozos` —heredado de la voladura primaria—, pero un bochón es un pozo y
--     lo que se cuenta son los bochones. Se renombra: es el mismo dato (la
--     importación puso ahí la columna "Metros perf." de la planilla, que en
--     los bochones es 1 por fila salvo excepción).
--
-- Renombrar y no agregar-y-copiar porque nada lee `pozos` de bochones todavía
-- —el editor no existe— así que no hay código viejo que se rompa, y dejar las
-- dos columnas sería la ambigüedad que el rename evita.
-- ============================================================

alter table cantera_bochones rename column pozos to cantidad;

alter table cantera_bochones
  add column if not exists fecha_voladura date;

comment on column cantera_bochones.cantidad is
  'Cuántos bochones (voladuras secundarias) agrupa este registro.';

notify pgrst, 'reload schema';
