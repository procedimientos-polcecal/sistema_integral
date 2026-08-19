-- ============================================================
-- SdG — Alta del módulo Compras en el enum de módulos
--
-- Este archivo tiene UNA sola sentencia, y es a propósito.
--
-- Postgres no deja usar un valor de enum nuevo hasta que la transacción que lo
-- agregó haya commiteado (error 55P04: "unsafe use of new value"). Como el
-- editor SQL de Supabase corre cada script dentro de una transacción, alcanza
-- con que el `alter type` viaje solo: cualquier cosa que mencione 'compras'
-- —incluso el cuerpo de una función, que se valida al crearla— tiene que ir en
-- una corrida posterior.
--
-- Por eso el orden es:
--   015 (este)  → agrega el valor al enum
--   016         → padrón de proveedores y funciones de permisos
--   017         → tablas del módulo
--   018         → políticas RLS
-- ============================================================

alter type modulo add value if not exists 'compras';
