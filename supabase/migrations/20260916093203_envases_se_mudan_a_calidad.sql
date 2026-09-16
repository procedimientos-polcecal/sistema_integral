-- ============================================================
-- SdG — El stock de envases se muda de Producción a Calidad
--
-- POR QUÉ
--
-- El 15/09, cuando se diseñó el stock de envases, el módulo `calidad` no
-- existía. Meterlo adentro de Producción tenía un argumento bueno: evitaba un
-- valor de enum nuevo y no obligaba a darle un permiso a nadie a mano, porque
-- quien carga el parte de fábrica es la misma gente.
--
-- El 16/09 ese argumento dejó de valer: el módulo `calidad` se creó igual, para
-- el stock de carbonilla (migraciones 20260916090407 y 20260916090409). Con las
-- dos cosas del mismo sector en módulos distintos, hacen falta **dos permisos
-- para la misma persona**: quien tiene `calidad` no ve los envases y quien tiene
-- `produccion` no ve la carbonilla.
--
-- Se muda ahora porque ahora es barato: renombrar no toca los datos —los 28
-- artículos y los 1.404 movimientos quedan donde están— y todavía no hay nadie
-- usando las pantallas.
--
-- QUÉ HACE FALTA ADEMÁS DEL RENOMBRE
--
-- Las policies **no** viajan con el nombre de la tabla: siguen llamando a
-- `tiene_acceso_produccion()`. Si sólo se renombraran las tablas, el módulo
-- quedaría en Calidad para el código y en Producción para RLS, que es la forma
-- de romper esto sin que nadie se entere hasta que alguien vea una lista vacía.
-- Es lo que ya corrigió la 029 en Mantenimiento.
-- ============================================================

-- ── 1. Las tablas ────────────────────────────────────────────

alter table if exists produccion_envases_articulos
  rename to calidad_envases_articulos;
alter table if exists produccion_envases_movimientos
  rename to calidad_envases_movimientos;
alter table if exists produccion_envases_proveedores
  rename to calidad_envases_proveedores;
alter table if exists produccion_envases_referencias
  rename to calidad_envases_referencias;
alter table if exists produccion_envases_referencias_historial
  rename to calidad_envases_referencias_historial;

-- ── 2. Índices, constraints y trigger ────────────────────────
--
-- Renombrar no es cosmético acá: un índice `produccion_envases_*` sobre una
-- tabla `calidad_envases_*` manda a buscar al módulo equivocado a quien lea un
-- error de Postgres dentro de seis meses.

alter index if exists produccion_envases_articulos_grupo_idx
  rename to calidad_envases_articulos_grupo_idx;
alter index if exists produccion_envases_articulos_faltante_idx
  rename to calidad_envases_articulos_faltante_idx;
alter index if exists produccion_envases_mov_articulo_idx
  rename to calidad_envases_mov_articulo_idx;
alter index if exists produccion_envases_mov_fecha_idx
  rename to calidad_envases_mov_fecha_idx;
alter index if exists produccion_envases_mov_sheets_fila_idx
  rename to calidad_envases_mov_sheets_fila_idx;
alter index if exists produccion_envases_mov_pendiente_idx
  rename to calidad_envases_mov_pendiente_idx;

alter table calidad_envases_movimientos
  rename constraint produccion_envases_mov_algo_paso to calidad_envases_mov_algo_paso;
alter table calidad_envases_movimientos
  rename constraint produccion_envases_mov_no_negativos to calidad_envases_mov_no_negativos;

alter trigger produccion_envases_articulos_updated_at on calidad_envases_articulos
  rename to calidad_envases_articulos_updated_at;

-- ── 3. Las policies, que son lo que de verdad cambia ─────────
--
-- Se borran por su nombre viejo —el renombre de la tabla no las renombra— y se
-- crean llamando a las funciones de Calidad.

drop policy if exists produccion_envases_articulos_select on calidad_envases_articulos;
drop policy if exists produccion_envases_articulos_write  on calidad_envases_articulos;
drop policy if exists produccion_envases_mov_select on calidad_envases_movimientos;
drop policy if exists produccion_envases_mov_insert on calidad_envases_movimientos;
drop policy if exists produccion_envases_mov_update on calidad_envases_movimientos;
drop policy if exists produccion_envases_prov_select on calidad_envases_proveedores;
drop policy if exists produccion_envases_ref_select on calidad_envases_referencias;
drop policy if exists produccion_envases_ref_hist_select on calidad_envases_referencias_historial;

create policy calidad_envases_articulos_select on calidad_envases_articulos
  for select to authenticated using (tiene_acceso_calidad());
create policy calidad_envases_articulos_write on calidad_envases_articulos
  for all to authenticated
  using (es_admin_calidad()) with check (es_admin_calidad());

create policy calidad_envases_mov_select on calidad_envases_movimientos
  for select to authenticated using (tiene_acceso_calidad());
create policy calidad_envases_mov_insert on calidad_envases_movimientos
  for insert to authenticated with check (puede_editar_calidad());
-- La ruta del alta actualiza sheets_pendiente sobre la fila que acaba de
-- insertar. Sin este update, un fallo de escritura en la planilla se perdería.
create policy calidad_envases_mov_update on calidad_envases_movimientos
  for update to authenticated
  using (puede_editar_calidad()) with check (puede_editar_calidad());

create policy calidad_envases_prov_select on calidad_envases_proveedores
  for select to authenticated using (tiene_acceso_calidad());
create policy calidad_envases_ref_select on calidad_envases_referencias
  for select to authenticated using (tiene_acceso_calidad());
create policy calidad_envases_ref_hist_select on calidad_envases_referencias_historial
  for select to authenticated using (tiene_acceso_calidad());

-- ── 4. El rastro de las sincronizaciones ─────────────────────
--
-- Las corridas ya anotadas dicen `modulo='produccion'`, y de acá en adelante el
-- código va a escribir y buscar `modulo='calidad'`. Sin esto, la pantalla diría
-- "sin sincronizar todavía" sobre datos que sí están — un cartel que no es
-- cierto es peor que no tener cartel.

update sincronizaciones
   set modulo = 'calidad'
 where modulo = 'produccion'
   and recurso in ('envases_articulos', 'envases_movimientos');

comment on table calidad_envases_articulos is
  'El catálogo de envases. Manda la planilla: stock_actual es lo que dijo su fórmula, no un cálculo del SdG.';
