-- ============================================================
-- SdG — Despacho: la planilla es una pestaña por mes
--
-- El spec asumió que `Órdenes de Carga` era una sola hoja. Se leyó el libro real
-- el 09/09/2026 y son **seis pestañas, una por mes** (`ABRIL 2026` …
-- `SEPTIEMBRE 2026`), con 1.714 órdenes entre todas.
--
-- Eso rompe el índice único que dejó la 20260908104729: la fila 45 de `ABRIL
-- 2026` y la 45 de `MAYO 2026` son dos órdenes distintas, y con un único global
-- sobre `sheets_fila` la segunda que se escriba viola la restricción.
--
-- La pestaña **no se guarda como columna**: se despeja del mes de `fecha`
-- (`pestanaDelMes` en lib/despacho/planilla.ts). Es la misma decisión que con
-- los tiempos y el estado — un derivado guardado se desincroniza y nada avisa —
-- y acá además la pestaña es literalmente el nombre del mes de la orden.
--
-- Por eso el único pasa a ser por (mes de la orden, fila), que es lo que
-- identifica una celda del libro.
-- ============================================================

drop index if exists despacho_ordenes_sheets_fila_uniq;

-- EL CAST A `timestamp` NO ES DECORATIVO: sin él esto falla con
-- `42P17: functions in index expression must be marked IMMUTABLE`.
--
-- `fecha` es un `date`, y `date` tiene cast implícito **a los dos**, `timestamp`
-- y `timestamptz`. Ante el empate Postgres elige el tipo preferido de la
-- categoría, que es `timestamptz` — y `date_trunc(text, timestamptz)` es
-- `STABLE`, no `IMMUTABLE`, porque su resultado depende del `TimeZone` de la
-- sesión. Un índice no puede depender de eso: la misma fila daría claves
-- distintas según quién consulte.
--
-- `date_trunc(text, timestamp)` sí es `IMMUTABLE`, y el `::timestamp` es lo que
-- la elige. (Ya se intentó sin el cast, el 09/09/2026, y el editor lo rechazó.)
--
-- Es un índice de expresión, o sea que **no puede ser destino de un
-- `ON CONFLICT`** (pariente de la trampa nº2 del README). No hace falta que lo
-- sea: el importador resuelve los choques por `numero`, que sigue siendo una
-- constraint completa.
create unique index if not exists despacho_ordenes_sheets_fila_uniq
  on despacho_ordenes_carga (date_trunc('month', fecha::timestamp), sheets_fila);
