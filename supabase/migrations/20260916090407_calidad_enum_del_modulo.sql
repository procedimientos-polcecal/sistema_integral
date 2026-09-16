-- ============================================================
-- SdG — El módulo Calidad entra al enum
--
-- Viaja solo y no hace nada más. Un valor nuevo de enum no se puede usar en la
-- misma transacción en que se agrega: Postgres devuelve 55P04 ("unsafe use of
-- new value of enum type"). Cualquier función o policy que mencione 'calidad'
-- —incluso en el cuerpo, que se valida al crearla— tiene que ir en un archivo
-- posterior, ya corrido y confirmado éste.
--
-- Es la trampa #1 del README de migraciones, y ya mordió dos veces.
-- Precedentes: 015 (compras), 045 (inventario), 20260907154332 (producción),
-- 20260908104728 (despacho).
--
-- Diseño: docs/superpowers/specs/2026-09-16-calidad-stock-de-carbonilla-design.md
-- ============================================================

alter type modulo add value if not exists 'calidad';
