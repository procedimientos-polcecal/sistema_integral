-- ============================================================
-- SdG — El módulo Facturación entra al enum
--
-- Viaja solo y no hace nada más. Un valor nuevo de enum no se puede usar en la
-- misma transacción en que se agrega: Postgres devuelve 55P04 ("unsafe use of
-- new value of enum type"). Cualquier función o policy que mencione
-- 'facturacion' —incluso en el cuerpo, que se valida al crearla— tiene que ir
-- en un archivo posterior, ya commiteado este.
--
-- Es la trampa #1 del README de migraciones, y ya mordió dos veces.
-- Precedentes: 015 (compras), 045 (inventario), 20260907154332 (producción),
-- 20260908104728 (despacho).
-- ============================================================

alter type modulo add value if not exists 'facturacion';
