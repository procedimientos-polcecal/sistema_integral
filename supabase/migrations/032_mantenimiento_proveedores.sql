-- ============================================================
-- SdG — Mantenimiento: los contratistas son proveedores
--
-- El delta trajo una tabla `contratistas` propia del módulo, con dos filas y
-- una sola columna. Pero `proveedores` ya existe desde la migración 016 con
-- `es_contratista`, y su comentario dice exactamente esto: "Distingue a quién
-- presta servicios (contratista de Mantenimiento) de quién provee materiales.
-- Un mismo proveedor puede ser las dos cosas."
--
-- Dos tablas para la misma cosa es cómo se termina con el mismo proveedor
-- cargado dos veces y ningún lado sabiendo cuál es el bueno.
-- ============================================================

-- ── 1. Los contratistas pasan a ser proveedores ──────────────
-- Los que ya existen quedan marcados; los que no, se crean.

insert into proveedores (nombre, es_contratista)
select nombre, true from contratistas
on conflict (nombre) do update set es_contratista = true;

drop table if exists contratistas;

-- ── 2. Las tablas de mantenimiento apuntan al proveedor ──────
--
-- El nombre en texto **se conserva**: es lo que dice la planilla, y la planilla
-- manda. `proveedor_id` es el enlace que permite cruzar el trabajo de un
-- proveedor entre Compras y Mantenimiento; queda en null mientras nadie lo
-- reconozca, que es más honesto que enlazarlo al que se le parece.

alter table ordenes_trabajo
  add column if not exists proveedor_id uuid references proveedores(id) on delete set null;

alter table ordenes_servicio
  add column if not exists proveedor_id uuid references proveedores(id) on delete set null;

alter table os_comparativas
  add column if not exists proveedor_id uuid references proveedores(id) on delete set null;

create index if not exists ot_proveedor_idx  on ordenes_trabajo (proveedor_id);
create index if not exists os_proveedor_idx  on ordenes_servicio (proveedor_id);
create index if not exists comp_proveedor_idx on os_comparativas (proveedor_id);

comment on column ordenes_trabajo.proveedor_id is
  'El proveedor de `contratista`, cuando se lo pudo reconocer. El texto crudo se conserva porque es lo que dice la planilla.';
