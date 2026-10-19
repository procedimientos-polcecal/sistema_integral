-- ============================================================
-- Un pedido se le puede comprar a varios proveedores (primer tiempo)
-- ============================================================
-- `compras_requerimientos.proveedor_id` es una sola clave foránea: un RI tiene
-- un proveedor y punto. Cuando la compra se reparte, la única salida que le
-- queda a la persona es CREAR UN PROVEEDOR QUE SE LLAME COMO LA LISTA. Medido
-- el 19/10/2026:
--
--   19 "proveedores" que son una lista, todos sin CUIT
--   21 RI comprados a una de ellas, por $176.390.406
--   16 de esos son de monto alto — más del 10% de los 152 RI caros
--    0 llegaron a tener una orden en Odoo, y 0 tienen número de OC
--
-- Y el catálogo crece con cada combinación: `TORRACO, BOLSAGRO` y
-- `BOLSAGRO, TORRACO` son dos registros distintos para el mismo par.
--
-- Esto es el PRIMER TIEMPO y sólo SUMA: crea la tabla hija y la llena.
-- `proveedor_id` no se toca, así que nada cambia en las 75 pantallas y rutas
-- que lo leen. Invertir el dueño —que `proveedor_id` pase a ser un reflejo
-- mantenido por un trigger— es el segundo tiempo, cuando éste lleve unos días
-- sin sorpresas. El diseño completo está en
-- `docs/superpowers/specs/2026-10-19-compras-un-pedido-a-varios-proveedores-design.md`.

-- ── La tabla ────────────────────────────────────────────────
create table if not exists public.compras_requerimiento_proveedores (
  requerimiento_id uuid not null references public.compras_requerimientos(id) on delete cascade,
  proveedor_id     uuid not null references public.proveedores(id)            on delete restrict,

  -- Cuánto le tocó a este proveedor. NULL es "no se sabe", y va a quedar null
  -- mucho tiempo: de los 21 repartidos, sólo 2 tienen de dónde sacarlo. NO se
  -- reparte en partes iguales — un $57.976.672 atribuido a TORRACO que nadie
  -- verificó se lee igual que uno medido.
  monto    numeric,
  cantidad numeric,

  created_at timestamptz not null default now(),

  primary key (requerimiento_id, proveedor_id)
);

-- Se consulta "los proveedores de este RI" y también "los RI de este proveedor"
-- —que es la pregunta que hoy contesta mal—. La PK sirve para la primera; esta
-- para la segunda.
create index if not exists compras_req_prov_proveedor_idx
  on public.compras_requerimiento_proveedores (proveedor_id);

alter table public.compras_requerimiento_proveedores enable row level security;

-- La misma forma que `compras_cotizaciones`, su hermana: la lee cualquier
-- autenticado y la escribe quien edita compras. Las llamadas van envueltas en
-- un `select` por la regla de las policies: sin eso Postgres las evalúa una vez
-- por fila.
drop policy if exists compras_req_prov_select on public.compras_requerimiento_proveedores;
create policy compras_req_prov_select on public.compras_requerimiento_proveedores
  for select to authenticated using (true);

drop policy if exists compras_req_prov_write on public.compras_requerimiento_proveedores;
create policy compras_req_prov_write on public.compras_requerimiento_proveedores
  for all to authenticated
  using ((select public.puede_editar_compras()))
  with check ((select public.puede_editar_compras()));

-- ── El proveedor que falta ──────────────────────────────────
-- `BOLSERA` no existe en ninguna forma en el catálogo: sólo vive adentro de dos
-- listas. Se crea sin CUIT porque no lo tenemos, y poner uno inventado sería
-- peor que no tenerlo: el CUIT es justamente con lo que Facturación cruza.
insert into public.proveedores (nombre, activo)
select 'BOLSERA', true
where not exists (
  select 1 from public.proveedores
  where upper(btrim(nombre)) = 'BOLSERA'
);

-- ── El relleno ──────────────────────────────────────────────
--
-- Se resuelve cada nombre contra el catálogo por nombre normalizado, y cuando
-- hay dos candidatos GANA EL QUE TIENE CUIT. Eso no es un capricho: el catálogo
-- tiene 71 nombres duplicados en 150 filas, con el patrón de administración
-- cargando "Mayúscula inicial" con CUIT y la importación de la planilla
-- creando otro en MAYÚSCULAS sin CUIT. De los 18 nombres que viven adentro de
-- las listas, 10 tienen ese doble, y el bueno es el que Odoo puede cruzar.
with proveedor_normalizado as (
  select
    p.id,
    p.cuit,
    btrim(regexp_replace(
      upper(translate(p.nombre,
        'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ',
        'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC')),
      '[^A-Z0-9]+', ' ', 'g')) as clave
  from public.proveedores p
  -- Los que son una lista no son candidatos: son justamente lo que se deshace.
  where position(',' in p.nombre) = 0
),
-- Uno por nombre: el que tiene CUIT primero.
candidato as (
  select distinct on (clave) clave, id
  from proveedor_normalizado
  order by clave, (cuit is not null) desc, id
),
-- Cada RI con proveedor, y las partes del nombre de ese proveedor. Para los
-- 1.940 de un solo proveedor esto devuelve una parte y resuelve a sí mismo.
parte as (
  select
    r.id as requerimiento_id,
    btrim(regexp_replace(
      upper(translate(trozo,
        'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ',
        'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC')),
      '[^A-Z0-9]+', ' ', 'g')) as clave
  from public.compras_requerimientos r
  join public.proveedores p on p.id = r.proveedor_id
  cross join lateral unnest(string_to_array(p.nombre, ',')) as trozo
  where r.proveedor_id is not null
),
-- Las dos excepciones van NOMBRADAS y no en una heurística: dos casos conocidos
-- se resuelven mejor con dos líneas que con una regla difusa que mañana enlace
-- mal un tercero. `RECYCLE BAG` es el singular de `Recycle Bags`, que existe
-- con CUIT 30-71442874-4.
parte_corregida as (
  select requerimiento_id,
         case when clave = 'RECYCLE BAG' then 'RECYCLE BAGS' else clave end as clave
  from parte
  where clave <> ''
)
insert into public.compras_requerimiento_proveedores (requerimiento_id, proveedor_id)
select distinct pc.requerimiento_id, c.id
from parte_corregida pc
join candidato c on c.clave = pc.clave
on conflict (requerimiento_id, proveedor_id) do nothing;

-- ── Los dos repartos que sí se conocen ──────────────────────
--
-- Son los únicos dos de los 21 que tienen de dónde sacar el monto, y los dos
-- salieron del libro SEGUIMIENTO DE COMPRA, no del sistema:
--
--   RI 472 — dos filas de entrega: TORRACO 180 y BRALBOL 1000
--   RI 708 — una fila, pero alguien escribió "BOLSAGRO (400), TORRACO (600)"
--
-- Ese RI 708 es la prueba de que esto hacía falta: la persona NECESITÓ anotar
-- el reparto y lo metió entre paréntesis adentro del nombre del proveedor,
-- porque no había dónde ponerlo.
--
-- Va la CANTIDAD y no el monto: es lo que dice el dato. Inventar el monto
-- dividiendo por la cantidad sería suponer que las dos partes salieron al mismo
-- precio unitario, que es justamente lo que no sabemos.
update public.compras_requerimiento_proveedores rp
   set cantidad = v.cantidad
  from (values
    (472,  'TORRACO',   180::numeric),
    (472,  'BRALBOL',  1000::numeric),
    (708,  'BOLSAGRO',  400::numeric),
    (708,  'TORRACO',   600::numeric)
  ) as v(nro_ri, nombre, cantidad)
 where rp.requerimiento_id = (
         select id from public.compras_requerimientos where nro_ri = v.nro_ri
       )
   and rp.proveedor_id = (
         select id from public.proveedores
          where upper(btrim(nombre)) = v.nombre
            and position(',' in nombre) = 0
          order by (cuit is not null) desc, id
          limit 1
       );

comment on table public.compras_requerimiento_proveedores is
  'Qué proveedores participaron de un requerimiento. Una fila por proveedor, SIEMPRE, también cuando es uno solo: si la tabla vale sólo para el caso raro, el caso raro es el que nadie prueba. `monto` null es "no se sabe cuánto le tocó" y así queda en 19 de los 21 repartidos: no se divide en partes iguales.';
