-- ============================================================
-- SdG — El módulo Producción entra al enum
--
-- Viaja solo y no hace nada más. Un valor nuevo de enum no se puede usar en la
-- misma transacción en que se agrega: Postgres devuelve 55P04 ("unsafe use of
-- new value of enum type"). Cualquier función o policy que mencione
-- 'produccion' tiene que ir en un archivo posterior, ya commiteado este.
--
-- Es la trampa #1 del README de migraciones, y ya mordió dos veces.
-- ============================================================

alter type modulo add value if not exists 'produccion';
