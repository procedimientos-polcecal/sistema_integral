-- ============================================================
-- SdG — Alta del módulo Inventario en el enum de módulos
--
-- Este archivo tiene UNA sola sentencia, y es a propósito. Es la misma lección
-- que la 015 dejó escrita para Compras:
--
-- Postgres no deja usar un valor de enum nuevo hasta que la transacción que lo
-- agregó haya commiteado (error 55P04: "unsafe use of new value"). Como el
-- editor SQL de Supabase corre cada script dentro de una transacción, alcanza
-- con que el `alter type` viaje solo: cualquier cosa que mencione 'inventario'
-- —incluso el cuerpo de una función, que se valida al crearla— tiene que ir en
-- una corrida posterior.
--
-- Por eso el orden es:
--   045 (este)  → agrega el valor al enum
--   046         → permisos, tablas, RPC y RLS del módulo
-- ============================================================

alter type modulo add value if not exists 'inventario';
