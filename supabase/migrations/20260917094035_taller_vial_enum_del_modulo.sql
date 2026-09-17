-- ============================================================
-- SdG — El módulo Taller Vial entra al enum
--
-- Viaja solo y no hace nada más. Un valor nuevo de enum no se puede usar en la
-- misma transacción en que se agrega: Postgres devuelve 55P04 ("unsafe use of
-- new value of enum type"). Cualquier función o policy que mencione
-- 'taller_vial' —incluso en el cuerpo, que se valida al crearla— tiene que ir
-- en un archivo posterior, ya commiteado este.
--
-- Es la trampa #1 del README de migraciones. Mismo patrón que cantera
-- (20260910103228) y calidad (20260916090407).
-- ============================================================

alter type modulo add value if not exists 'taller_vial';
