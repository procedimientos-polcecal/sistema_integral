-- ============================================================
-- SdG — El RI pegado a un repuesto de una OT
--
-- POR QUÉ EXISTE
--
-- Mantenimiento necesita anotar, sobre un repuesto de una orden de trabajo,
-- el número de RI (requerimiento de compra) con el que se pidió, para ver
-- desde la OT en qué quedó la compra. Hasta hoy ese vínculo no existía: el
-- repuesto de una OT es texto (`nombre`, `codigo`) y el RI vive en Compras.
--
-- EL DESTINO DEL VÍNCULO ES UNO DE DOS, Y NO SIEMPRE EL ARTÍCULO
--
-- Lo natural sería pegar el RI al artículo del pañol (`inventario_articulos`):
-- así vale para todas las OT que usen esa pieza. Pero medido el 13/11/2026,
-- **19 de los 26 repuestos cargados no resuelven a ningún artículo del pañol**:
-- grillas, baldes, un reflector simplemente no están en el catálogo. Un vínculo
-- que exigiera artículo sería inalcanzable justo donde más hace falta, en lo
-- que no se tiene en stock y hay que comprar.
--
-- Por eso el destino es uno de dos, y exactamente uno (`check` de abajo):
--   · `articulo_id`: el RI vale para ese artículo, en toda OT que lo use.
--   · `repuesto_id`: el RI vale para ese renglón de esa OT y nada más.
-- Además `ordenes_trabajo_repuestos.articulo_id` guarda, cuando una persona lo
-- elige, a qué artículo del pañol se refiere el renglón. Es opcional y queda en
-- null si el artículo se borra (`on delete set null`): el renglón sigue siendo
-- un repuesto con su nombre, sólo pierde el enlace. Nunca se completa solo por
-- parecido —enlazar al que se le parece es peor que dejar en null (README)—.
--
-- LOS DOS ÍNDICES ÚNICOS SON PARCIALES, Y ESO TIENE UNA CONSECUENCIA
--
-- Pegar dos veces el mismo RI al mismo destino no debe duplicar. Como el
-- destino son dos columnas excluyentes, una constraint única común sobre
-- (nro_ri, articulo_id) dejaría pasar duplicados de los que tienen
-- `articulo_id` null, y hacen falta dos índices, cada uno `where … is not null`.
--
-- **Un índice parcial no sirve como destino de `ON CONFLICT`** (es la segunda
-- trampa del README, ya pisada tres veces): un `upsert` contra estas columnas
-- falla con `42P10` recién la primera vez que se usa. Por eso la ruta que
-- inserta **no usa upsert**: hace un `insert` simple, atrapa el `23505`
-- (violación de unicidad) y lo devuelve como un 409 «ese RI ya está pegado».
-- Quien escriba o toque esa ruta no tiene que pelearse con la base: es así a
-- propósito.
--
-- EL BORRADO VA EN CASCADA DE LOS DOS LADOS
--
-- Si el artículo o el renglón de OT al que apunta el vínculo ya no existe, el
-- vínculo no es información: es una fila que nadie puede interpretar, un RI
-- colgado de nada. Por eso `articulo_id` y `repuesto_id` llevan `on delete
-- cascade`. (Es distinto de la columna nueva de `ordenes_trabajo_repuestos`,
-- que es `set null`: ahí lo que sobrevive es el renglón, que tiene sentido
-- solo.) `nro_ri` no es una foreign key a propósito: `compras_requerimientos`
-- se espeja de una planilla y borra lo que la planilla deja de tener, y un RI
-- que desaparece de allá no debe llevarse el vínculo ni impedir su carga.
--
-- A TENER EN CUENTA
--
-- · Orden: los `alter table` van antes del `create table` que referencia las
--   mismas tablas, para no subir de lock dentro de la transacción (`40P01`,
--   README).
-- · Se puede correr dos veces: todo con `if not exists` / `drop … if exists`.
-- · Nada de esto se puede probar sin la base: es DDL y lo corre una persona a
--   mano. Si falla, se corrige con otra migración, no editando ésta.
-- · La tabla puente toca `inventario_articulos` y `ordenes_trabajo_repuestos`,
--   y suma un segundo camino con cada una: si algún `select` embebe esas
--   tablas desde ésta o al revés, hay que nombrar el FK (`PGRST201`).
--   Ninguno existe todavía, así que nada que ya ande se rompe.
-- ============================================================

-- Primero el alter (ver «A tener en cuenta»).
alter table public.ordenes_trabajo_repuestos
  add column if not exists articulo_id uuid
  references public.inventario_articulos(id) on delete set null;

create table if not exists public.mant_ri_de_repuesto (
  id          uuid primary key default gen_random_uuid(),

  -- Número de RI, tal cual lo muestra Compras. Sin foreign key: ver el
  -- encabezado.
  nro_ri      integer not null,

  -- Exactamente uno de los dos, ver el `check`.
  articulo_id uuid references public.inventario_articulos(id) on delete cascade,
  repuesto_id uuid references public.ordenes_trabajo_repuestos(id) on delete cascade,

  creado_por  uuid references public.usuarios(id),
  creado_en   timestamptz not null default now(),

  constraint mant_ri_de_repuesto_un_destino
    check (num_nonnulls(articulo_id, repuesto_id) = 1)
);

-- Parciales a propósito y por eso sin upsert: ver el encabezado.
create unique index if not exists mant_ri_de_repuesto_ri_articulo_uq
  on public.mant_ri_de_repuesto (nro_ri, articulo_id)
  where articulo_id is not null;

create unique index if not exists mant_ri_de_repuesto_ri_repuesto_uq
  on public.mant_ri_de_repuesto (nro_ri, repuesto_id)
  where repuesto_id is not null;

-- Para traer los RI de un artículo o de un renglón sin recorrer la tabla, y
-- para que el borrado en cascada no tenga que leerla entera.
create index if not exists mant_ri_de_repuesto_articulo_idx
  on public.mant_ri_de_repuesto (articulo_id) where articulo_id is not null;
create index if not exists mant_ri_de_repuesto_repuesto_idx
  on public.mant_ri_de_repuesto (repuesto_id) where repuesto_id is not null;

alter table public.mant_ri_de_repuesto enable row level security;

-- Se ve con `mant_puede_ver()`; se inserta y se saca con `mant_puede_editar()`.
-- No hay policy de update: un vínculo no se corrige, se saca y se vuelve a
-- pegar. Las funciones van **envueltas en un subselect** —sin eso Postgres las
-- evalúa una vez por fila— y se llaman con paréntesis vacíos aunque declaren
-- un argumento con DEFAULT (README / CLAUDE.md, «Reglas de la base»).
drop policy if exists mant_ri_de_repuesto_select on public.mant_ri_de_repuesto;
create policy mant_ri_de_repuesto_select on public.mant_ri_de_repuesto
  for select to authenticated
  using ((select mant_puede_ver()));

drop policy if exists mant_ri_de_repuesto_insert on public.mant_ri_de_repuesto;
create policy mant_ri_de_repuesto_insert on public.mant_ri_de_repuesto
  for insert to authenticated
  with check ((select mant_puede_editar()));

drop policy if exists mant_ri_de_repuesto_delete on public.mant_ri_de_repuesto;
create policy mant_ri_de_repuesto_delete on public.mant_ri_de_repuesto
  for delete to authenticated
  using ((select mant_puede_editar()));

comment on table public.mant_ri_de_repuesto is
  'Un RI de Compras pegado a un repuesto de una OT: o a un artículo del pañol (vale para toda OT que lo use) o a un renglón de una OT (vale sólo ahí). Exactamente uno de los dos destinos. Sin upsert: los índices únicos son parciales.';
