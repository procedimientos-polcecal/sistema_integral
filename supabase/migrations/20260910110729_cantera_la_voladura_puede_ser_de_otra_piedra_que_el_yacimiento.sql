-- ============================================================
-- SdG — Cantera: piedra por voladura y perforación por tramos
--
-- Dos correcciones al schema (20260910103229) que salieron de la revisión del
-- usuario el 10/09/2026, antes de que este archivo se aplicara. Van juntas
-- porque tocan la misma tabla y ninguna se usó todavía.
--
-- 1) MATERIAL Y DENSIDAD POR VOLADURA. El schema puso `material` y
--    `densidad_t_m3` en `cantera_yacimientos`, dando por hecho que cada cantera
--    da una sola piedra. **De C1 y C3 se saca tanto Chocolata como Caliza**, y
--    la densidad —que entra en la fórmula de toneladas— va con la piedra, no
--    con la cantera. Dos columnas nullables en la voladura: si está en null, el
--    cálculo cae en las del yacimiento. Mismo patrón que la malla real.
--
-- 2) PERFORACIÓN POR TRAMOS. Los pozos de una voladura no tienen todos la misma
--    profundidad. Se informan así: "14*3 / 3*3,5 / 6*4" = 14 pozos a 3 m, 3 a
--    3,5 y 6 a 4. `perf_tramos` / `vol_tramos` guardan ese arreglo como jsonb
--    (`[{"pozos":14,"metros":3}, ...]`). Las columnas escalares `pozos` y
--    `metros_por_pozo` quedan —las llena la importación con el promedio de la
--    planilla vieja, que no trae el desglose— pero el cálculo usa los tramos
--    cuando están: metros perforados = Σ(pozos·metros).
--
-- No toca `cantera_bochones`: la secundaria es un pozo por bochón.
--
-- Va en una migración aparte y no editando la 20260910103229 sólo si ésa ya
-- corrió. Si todavía no corrió, da igual el orden.
-- ============================================================

alter table cantera_voladuras
  add column if not exists material      text,
  add column if not exists densidad_t_m3 numeric,
  add column if not exists perf_tramos   jsonb,
  add column if not exists vol_tramos    jsonb;

comment on column cantera_voladuras.densidad_t_m3 is
  'Densidad de la piedra volada, cuando difiere de la nominal del yacimiento (C1/C3 dan Chocolata y Caliza). Null = usar la del yacimiento.';

comment on column cantera_voladuras.perf_tramos is
  'Los pozos de perforación por profundidad: [{"pozos":14,"metros":3},...]. La cuenta usa esto; pozos y metros_por_pozo quedan como el promedio que trae la planilla vieja.';

notify pgrst, 'reload schema';
