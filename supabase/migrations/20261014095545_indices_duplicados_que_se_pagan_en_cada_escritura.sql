-- ============================================================
-- SdG — Índices duplicados, que se pagan en cada escritura
--
-- Tres columnas tienen **dos índices iguales**. Un índice no es gratis: cada
-- `insert` y cada `update` de esa tabla tiene que actualizarlo, así que un
-- duplicado es trabajo que se paga siempre y no sirve nunca.
--
-- Medido el 14/10/2026 con `pg_stat_user_indexes`:
--
--     indice                         unico  sostiene_restriccion  usos
--     equipos_code_idx               no     no                     173
--     equipos_code_key               sí     sí                       0
--     ordenes_trabajo_proveedor_idx  no     no                       0
--     ot_proveedor_idx               no     no                      26
--     proveedores_nombre_idx         no     no                     552
--     proveedores_nombre_key         sí     sí                     383
--
-- EN LOS TRES CASOS SE BORRA EL NO ÚNICO, y no es una preferencia estética: el
-- otro **sostiene una restricción `unique`** y no se puede borrar sin borrar la
-- restricción, que es justo lo que no se quiere. En `ordenes_trabajo` ninguno
-- de los dos sostiene nada, así que ahí decide el uso: uno tiene 26 y el otro
-- **cero**.
--
-- ¿Y QUE SE BORREN LOS QUE MÁS SE USAN NO ES AL REVÉS? No. En `equipos` y en
-- `proveedores` el que el planner viene eligiendo es el no único, pero el que
-- queda cubre **la misma columna**: lo que hoy resuelve uno lo va a resolver el
-- otro, con el mismo plan. Lo que cambia es que deja de haber dos estructuras
-- que mantener para responder la misma pregunta.
--
-- Es chico —son 104 kB y unas pocas escrituras por día— y conviene decirlo: no
-- es lo que va a hacer que el sistema se sienta rápido. Lo que mueve la aguja
-- es `20261014090512`, que saca la evaluación de RLS por fila. Esto es
-- prolijidad que se encontró midiendo aquello.
--
-- Repetible: `drop index if exists` no se queja si ya corrió.
-- ============================================================

-- `equipos.code`: queda `equipos_code_key`, que sostiene el `unique`.
drop index if exists public.equipos_code_idx;

-- `ordenes_trabajo.proveedor_id`: ninguno sostiene nada, queda el que se usa.
drop index if exists public.ordenes_trabajo_proveedor_idx;

-- `proveedores.nombre`: queda `proveedores_nombre_key`, que sostiene el `unique`.
drop index if exists public.proveedores_nombre_idx;

-- Para comprobarlo: no tiene que quedar ninguna columna con dos índices iguales.
--
--   select t.tablename, string_agg(t.indexname, ' + ') as duplicados
--     from (select tablename, indexname,
--                  regexp_replace(indexdef, '^.*USING ', '') as cols
--             from pg_indexes where schemaname = 'public') t
--    group by t.tablename, t.cols
--   having count(*) > 1;
--   -- tiene que dar 0 filas
