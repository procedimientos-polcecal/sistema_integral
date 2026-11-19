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
-- LOS DOS ÍNDICES ÚNICOS SON COMUNES, NO PARCIALES, Y NO ES UN DETALLE
--
-- Pegar dos veces el mismo RI al mismo destino no debe duplicar. Como el
-- destino son dos columnas excluyentes hacen falta dos índices únicos, uno por
-- destino: (articulo_id, nro_ri) y (repuesto_id, nro_ri).
--
-- Son **comunes y no `where … is not null`** para que sigan siendo destino de
-- un `ON CONFLICT`: un índice parcial no lo es y hace fallar el `upsert` con
-- `42P10` recién la primera vez que se usa (segunda trampa del README, ya pisada
-- tres veces). Y no se pierde nada: las filas con `articulo_id` null tienen
-- clave (null, r), y los nulos no chocan entre sí, así que no se rechazan; es
-- correcto, porque esas filas son del otro índice y no necesitan protegerse
-- entre sí. La protección contra el duplicado es idéntica a la de uno parcial.
-- Llevan el destino primero para que además sirvan para buscar por destino, y
-- por eso no hay índices sueltos aparte.
--
-- EL BORRADO VA EN CASCADA DE LOS DOS LADOS, Y NO HAY OTRA OPCIÓN
--
-- `on delete set null` acá no es peor: **no se puede**. Si el borrado del padre
-- dejara `repuesto_id` en null, la fila quedaría con `num_nonnulls = 0`, el
-- `check` dispararía y el `DELETE` del padre fallaría, y con él
-- `borrarLoQueLaPlanillaNoTrajo` de `lib/mantenimiento/sincronizar.ts`, no sólo
-- esta tabla. Ojo con el precedente cercano: `20261029082249` le puso `on delete
-- set null` a `ordenes_trabajo_notas.repuesto_id`, y quien lo copie rompe el
-- borrado de OT. Además un vínculo a algo que ya no existe no es información.
--
-- Lo que se pierde, y por qué camino: el realista es el espejo. Una fila sale de
-- la planilla, se borra la OT y, según CLAUDE.md, esa cascada se lleva sus
-- notas, sus repuestos y su aviso, y con los repuestos estos vínculos. **Los RI
-- pegados se tipean a mano y no existen en ninguna planilla**, así que a
-- diferencia de lo demás que ese borrado se lleva, no se recuperan releyendo
-- Sheets. `nro_ri` no es una foreign key a propósito: `compras_requerimientos`
-- también espeja una planilla y un RI que desaparece de allá no debe llevarse
-- el vínculo ni impedir su carga.
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

-- Comunes a propósito, para que sigan siendo destino de `ON CONFLICT`: ver el
-- encabezado. El destino va primero para servir también a la búsqueda por él.
create unique index if not exists mant_ri_de_repuesto_articulo_ri_uq
  on public.mant_ri_de_repuesto (articulo_id, nro_ri);

create unique index if not exists mant_ri_de_repuesto_repuesto_ri_uq
  on public.mant_ri_de_repuesto (repuesto_id, nro_ri);

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
  'Un RI de Compras pegado a un repuesto de una OT: o a un artículo del pañol (vale para toda OT que lo use) o a un renglón de una OT (vale sólo ahí). Exactamente uno de los dos destinos. Los índices únicos son comunes: sirven de destino de ON CONFLICT.';

comment on column public.ordenes_trabajo_repuestos.articulo_id is
  'Artículo del pañol al que se refiere el renglón, si una persona lo eligió. Null quiere decir que nadie lo enlazó, nunca que el artículo no exista. No se completa por parecido de nombre.';

comment on column public.mant_ri_de_repuesto.nro_ri is
  'Número de RI de Compras. NO es una foreign key a compras_requerimientos: cruzarlo con esa tabla pierde en silencio los RI que la planilla ya dejó de tener.';

comment on column public.mant_ri_de_repuesto.repuesto_id is
  'Renglón de repuesto de una OT al que se pegó el RI (destino alternativo a articulo_id; exactamente uno de los dos). Va en cascada: no puede ser set null porque el check exige un destino.';
