-- ============================================================
-- SdG - Productos: el catalogo unico del nucleo
--
-- Spec: docs/superpowers/specs/2026-09-10-productos-catalogo-unico-design.md
--
-- POR QUE. Dos modulos describian las mismas cosas fisicas con dos
-- vocabularios distintos, en dos tablas, y las dos estaban **vacias**:
-- `produccion_productos` (familia + envase) y `despacho_productos` (material x
-- granulometria x envase). No era solo que usaran nombres distintos: tenian
-- **grano distinto** -- la familia `0_2` no dice el material, y en el libro de
-- Despacho `Calcio 0-2 en Bolson` son 135 ordenes y `Dolomita 0-2 en Bolson`
-- 20, dos cosas que ese vocabulario cuenta juntas.
--
-- Que las dos estuvieran vacias es lo que hace que este sea el momento: no hay
-- una fila que migrar, y `produccion_deposito.producto_id` -- que esta en su
-- clave primaria -- se puede renombrar gratis.
--
-- LA IDENTIDAD ES EL PRODUCTO DE ODOO, NO LA TERNA. Se midio antes de
-- decidirlo: de 432 `product.product`, **49 salieron** en 180 dias (2.786
-- lineas de remito) y 26 cubren el 92%. Y tres productos distintos comparten la
-- terna (Cal, -, Bolson): `[CEB6570] CAL EN BOLSONES CUV 65-70` (362 lineas),
-- `[CEBPD] ... PUESTA EN DESTINO` (268) y `[CEB5560] ... CUV 55-60` (16). Son
-- 646 lineas, el 23% de todo lo que sale, que con la terna como clave caerian
-- en una sola fila -- y CUV 65-70 contra 55-60 es una especificacion de
-- calidad, no una ortografia. Ademas el mas despachado de todos,
-- `[ME] MINERALES ECOLOGICOS` (379 lineas), no tiene terna posible, y las
-- marcas -- `Cal Bolsa guemes`, `Cal Bolsa Moreno (UNIDAD)` -- son productos
-- reales de Odoo, no erratas del libro.
--
-- Asi que la terna queda como **clasificacion** encima de la identidad. Para el
-- historico de Despacho eso no cambia nada: el libro nunca supo estas
-- distinciones -- dice "Cal en Bolsones" para las tres CUV -- y las 159
-- equivalencias de lib/despacho/equivalenciasDelHistorico.ts siguen devolviendo
-- ternas.
--
-- LA SIEMBRA VA SIN CLASIFICAR, A PROPOSITO. Poner la terna leyendo
-- `[CEB6570] CAL EN BOLSONES CUV 65-70` seria parsear el nombre del producto,
-- que es justo lo que el modulo prohibe y la razon de que exista una tabla de
-- mapeo. Lo que la siembra resuelve es que nadie tenga que buscar los
-- productos: quedan las 49 en la pantalla, ordenadas por volumen. Los 383 que
-- no salieron en seis meses no se siembran: no son catalogo, son ruido.
--
-- SOBRE LA TABLA PUENTE Y EL PGRST201 (trampa #5 del README). Una tabla con
-- exactamente dos claves foraneas hace que PostgREST vea un segundo camino
-- entre esas dos tablas y rompe los embeds que ya andaban. Aca no puede pasar:
-- el puente une `produccion_renglones_papel` con `productos`, y `productos` es
-- nueva, asi que no hay ningun select que las embeba. Queda dicho porque la
-- proxima tabla puente si va a tener que buscarlo.
-- ============================================================

-- == 1. El catalogo ==========================================

create table if not exists productos (
  id                uuid primary key default gen_random_uuid(),

  -- La identidad. Unico y nullable de verdad: fabrica puede hacer algo que Odoo
  -- no vende con ese nombre, y en Postgres los nulos no chocan entre si, asi
  -- que varios productos sin Odoo conviven. Es un unique comun y no un indice
  -- parcial, porque un parcial no sirve de destino de ON CONFLICT (trampa #2
  -- del README, que ya mordio dos veces).
  odoo_product_id   int unique,
  -- La referencia interna ([CEB6570], [FAG], [ME]) y el nombre, cacheados para
  -- mostrar y buscar sin ir a Odoo, que tarda: el alta con el camion esperando
  -- no puede depender de una llamada.
  odoo_default_code text,
  nombre            text not null,

  -- La clasificacion. Los tres o ninguno: un producto sin clasificar se muestra
  -- con su nombre de Odoo, y es un estado valido -- Minerales Ecologicos, Binder
  -- y Tosca no tienen terna.
  material          text,
  granulometria     text,
  envase            text,

  -- La bolsa son 25 kg. El bolson sigue sin confirmar, asi que null: un numero
  -- inventado aca haria fallar la comprobacion kilos/bultos de Produccion en
  -- todos los renglones, y se terminaria apagando la comprobacion.
  kg_por_unidad     numeric,

  -- El nuestro, no el de Odoo. Los 5 que Odoo tiene archivados entran
  -- inactivos, porque un remito viejo los sigue nombrando.
  activo            boolean not null default true,

  cargado_por       uuid references usuarios(id),
  cargado_en        timestamptz not null default now(),
  actualizado_por   uuid references usuarios(id),
  actualizado_en    timestamptz,

  -- Material y envase van o faltan juntos; una granulometria sin material no
  -- existe. La granulometria sola si puede faltar: Chocolata y Pedregullo no
  -- tienen. Media clasificacion no es un dato incompleto: es uno que filtra mal
  -- y no se nota.
  constraint productos_clasificacion_entera check (
    (material is null) = (envase is null)
    and (granulometria is null or material is not null)
  )
);

comment on table productos is
  'El catalogo unico de lo que la planta produce y despacha. La identidad es el '
  'producto de Odoo; material/granulometria/envase son una clasificacion encima '
  'que puede faltar entera. Lo comparten Produccion (por '
  'produccion_renglon_productos) y Despacho (por '
  'despacho_ordenes_carga.odoo_product_id). No incluye los repuestos de '
  'Inventario, que son otro dominio.';

create index if not exists productos_activo_idx on productos (activo);

-- == 2. Permisos =============================================

-- Lo escribe quien administra Produccion o Despacho, no Administracion: ahi
-- quedaron tres personas (20260910084718) y este catalogo lo carga la planta.
-- Es el modelo de `proveedores`, que tambien es del nucleo y se escribe con
-- puede_editar_compras().
create or replace function public.puede_editar_productos()
returns boolean
language sql stable security definer set search_path = public
as $$
  select es_admin_produccion() or es_admin_despacho()
$$;

comment on function public.puede_editar_productos() is
  'Quien puede escribir el catalogo de productos: admin de Produccion o de '
  'Despacho. Las dos funciones ya incluyen a admin_sistema.';

alter table productos enable row level security;

-- La lectura es abierta, como en el resto de los catalogos del nucleo
-- (empresas, sectores, empleados): saber como se llama un producto no es un
-- permiso, y el dia que Compras o Inventario lo necesiten no hay que volver
-- aca.
drop policy if exists productos_select on productos;
create policy productos_select on productos
  for select to authenticated using (true);

drop policy if exists productos_write on productos;
create policy productos_write on productos
  for all to authenticated
  using (puede_editar_productos())
  with check (puede_editar_productos());

-- == 3. La siembra: los 49 que salieron en 180 dias ==========

insert into productos (odoo_product_id, odoo_default_code, nombre, activo) values
  (4375, 'ME', 'MINERALES ECOLOGICOS', true), -- 379 lineas
  (2397, 'CEB6570', 'CAL EN BOLSONES CUV 65-70', true), -- 362 lineas
  (3978, 'FillerM', 'FILLER CALCAREO MEMBRA', true), -- 313 lineas
  (2398, 'CEBPD', 'CAL EN BOLSONES PUESTA EN DESTINO', true), -- 268 lineas
  (4382, 'CC02B', 'CARBONATO DE CALCIO 0-2 BOLSÓN (NA)', true), -- 227 lineas
  (7052, 'ADCA', 'ADITIVO CALCAREO', true), -- 211 lineas
  (4405, 'FMAF', 'FILLER CALCAREO (TOLVA)', true), -- 116 lineas
  (2399, 'CET', 'CAL EN TOLVA', true), -- 82 lineas
  (3981, 'C02C', 'CALCIO 0-2 GRANEL (CERÁMICA)', true), -- 73 lineas
  (2394, 'FAG', 'FILLER A GRANEL', true), -- 71 lineas
  (3986, 'C01BNA', 'CARBONATO DE CALCIO 0-1 BOLSÓN (NA)', true), -- 62 lineas
  (2406, 'P620', 'Pedregullo 6/20', true), -- 62 lineas
  (2393, 'CBFG', 'Cal Bolsa Filca guemes', true), -- 60 lineas
  (4576, 'D02BOEA', 'DOLOMITA 0-2 BOLSONES (EA)', true), -- 42 lineas
  (2395, 'BIN', 'BINDER', true), -- 40 lineas
  (2390, 'CBG', 'Cal Bolsa guemes', true), -- 39 lineas
  (7053, 'CGFB', 'Cal guemes Fillerizada en Bolsas', true), -- 36 lineas
  (3985, 'C1/2BNA', 'CARBONATO DE CALCIO 01/02 BOLSÓN (NA)', true), -- 34 lineas
  (3983, 'C02BNA', 'CARBONATO DE CALCIO 0-2 BOLSA (NA)', true), -- 32 lineas
  (2400, 'ESD', 'ESTABILIZADO DE DOLOMITA', true), -- 30 lineas
  (3987, 'C200BNA', 'CARBONATO DE CALCIO #200 EN BOLSONES (NA)', true), -- 26 lineas
  (7049, 'AC', 'ADITIVO CALCAREO**', false), -- 22 lineas
  (4402, 'CC200B', 'CARBONATO DE CALCIO #200 EN BOLSA (NA)', true), -- 22 lineas
  (4577, 'D02B', 'DOLOMITA 0-2 BOLSAS (NA)', true), -- 18 lineas
  (5315, 'CC01G', 'CARBONATO DE CALCIO 0-1 GRANEL', true), -- 17 lineas
  (2396, 'CEB5560', 'CAL EN BOLSONES CUV 55-60', true), -- 16 lineas
  (2392, 'CBMU', 'Cal Bolsa Moreno (UNIDAD)', true), -- 15 lineas
  (3991, 'M200BEA', 'Magnesio #200 Bolsones (EA)', true), -- 12 lineas
  (3990, 'C02BEA', 'CALCIO 0-2 BOLSÓN (EA)', true), -- 10 lineas
  (7100, 'CC200G', 'CARBONATO DE CALCIO #200 A GRANEL', true), -- 9 lineas
  (2401, 'CHO', 'Chocolata', true), -- 9 lineas
  (7085, null, 'TOSCA', true), -- 9 lineas
  (3995, 'Bochas', 'ARENA CANCHA DE BOCHAS', true), -- 8 lineas
  (2403, 'CDC', 'CARBONATO DE CALCIO', false), -- 7 lineas
  (2402, 'DOL', 'DOLOMITA', true), -- 7 lineas
  (2407, 'FEB', 'FILLER EN BOLSONES', true), -- 7 lineas
  (4608, 'B200MAG', 'BOLSAS #200 MAGNESIO AGRICOLA', false), -- 5 lineas
  (5365, 'CC200BEA', 'CARBONATO DE CALCIO #200 EN BOLSONES (EA)', true), -- 4 lineas
  (7106, 'P1030', 'Pedregullo 10/30 (Piedra Hornos)', true), -- 4 lineas
  (4606, 'B200MNA', 'BOLSAS #200 MAGNESIO NUTRICIÓN ANIMAL', false), -- 3 lineas
  (4957, 'C02G', 'CALCIO 0-2 GRANEL', true), -- 3 lineas
  (2391, 'CBMT', 'Cal Bolsa Moreno (TN)', true), -- 3 lineas
  (4377, 'D200B', 'DOLOMITA #200 EN BOLSONES', false), -- 3 lineas
  (3984, 'C1/2GNA', 'CARBONATO DE CALCIO 01/02 GRANEL (NA)', true), -- 2 lineas
  (4449, 'CC02BU', 'Carbonato de Calcio 0-2 Bolsa (NA) (UNIDAD)', true), -- 2 lineas
  (7074, 'CC200', 'CARBONATO DE CALCIO', true), -- 1 lineas
  (3993, 'D02BEA', 'DOLOMITA 0-2 BOLSAS (EA)', true), -- 1 lineas
  (7084, 'D02G', 'DOLOMITA 0-2 A GRANEL', true), -- 1 lineas
  (7104, 'OXI', 'OXIMAG EN BOLSONES', true) -- 1 lineas
on conflict (odoo_product_id) do nothing;

-- == 4. Se va despacho_productos =============================

-- Su trabajo se reparte: el ancla de Odoo y la terna estan en `productos`, y su
-- `produccion_producto_id` lo reemplaza el puente. Va antes del rename para no
-- arrastrar su clave foranea a produccion_productos. Estaba vacia.
drop table if exists despacho_productos;

-- == 5. produccion_productos pasa a ser el renglon del papel ==

-- Deja de ser un catalogo y pasa a ser lo que siempre fue: el renglon del parte
-- y la columna del Excel. `nombre_planilla` y `orden` no son propiedades de un
-- bolson de calcio, son de como se imprime el parte y como se exporta la
-- planilla. El nombre esta libre: no existe ninguna `produccion_renglones`.
alter table if exists produccion_productos rename to produccion_renglones_papel;

-- `envase` y `kg_por_unidad` son del producto fisico y se fueron al nucleo. El
-- tipo `produccion_envase` queda sin uso: no se borra porque no molesta, y
-- borrarlo obliga a recrearlo si alguien lo vuelve a necesitar.
alter table produccion_renglones_papel drop column if exists envase;
alter table produccion_renglones_papel drop column if exists kg_por_unidad;

alter index if exists produccion_productos_nombre_idx
  rename to produccion_renglones_papel_nombre_idx;

-- Las policies siguen a la tabla renombrada, pero con su nombre viejo.
drop policy if exists produccion_productos_select on produccion_renglones_papel;
drop policy if exists produccion_productos_write  on produccion_renglones_papel;

drop policy if exists produccion_renglones_papel_select on produccion_renglones_papel;
create policy produccion_renglones_papel_select on produccion_renglones_papel
  for select to authenticated using (tiene_acceso_produccion());

drop policy if exists produccion_renglones_papel_write on produccion_renglones_papel;
create policy produccion_renglones_papel_write on produccion_renglones_papel
  for all to authenticated
  using (es_admin_produccion())
  with check (es_admin_produccion());

comment on table produccion_renglones_papel is
  'Los ~15 renglones del parte en papel y las 17 columnas del Excel. No es un '
  'catalogo de productos: eso es `productos`, en el nucleo. La correspondencia '
  'entre uno y otro la define calidad y vive en produccion_renglon_productos.';

-- == 6. Las dos columnas que apuntaban al catalogo ===========

-- `produccion_deposito.producto_id` esta en su clave primaria (parte_id,
-- producto_id): con datos esto no seria un rename. Esta vacia.
alter table produccion_deposito  rename column producto_id to renglon_papel_id;
alter table produccion_despachos rename column producto_id to renglon_papel_id;

-- == 7. El puente, de muchos a muchos ========================

-- Muchos a muchos y no una columna, por lo que se midio: si el papel cuenta
-- "cal en bolson" en un solo renglon, ese renglon apunta a CUV 65-70, CUV 55-60
-- y Puesta en Destino, y la suma sale bien sin que nadie tenga que elegir una y
-- perder dos en silencio. Nadie sabe hoy si el papel las cuenta juntas -- eso lo
-- define calidad -- y el modelo no lo prejuzga.
create table if not exists produccion_renglon_productos (
  renglon_papel_id uuid not null references produccion_renglones_papel(id) on delete cascade,
  producto_id      uuid not null references productos(id) on delete cascade,
  primary key (renglon_papel_id, producto_id)
);

-- Por producto: "en que renglon del papel se cuenta esto" es la pregunta del
-- cruce con Despacho. Por renglon ya lo resuelve la clave primaria.
create index if not exists produccion_renglon_productos_producto_idx
  on produccion_renglon_productos (producto_id);

alter table produccion_renglon_productos enable row level security;

drop policy if exists produccion_renglon_productos_select on produccion_renglon_productos;
create policy produccion_renglon_productos_select on produccion_renglon_productos
  for select to authenticated using (tiene_acceso_produccion());

drop policy if exists produccion_renglon_productos_write on produccion_renglon_productos;
create policy produccion_renglon_productos_write on produccion_renglon_productos
  for all to authenticated
  using (es_admin_produccion())
  with check (es_admin_produccion());

notify pgrst, 'reload schema';
