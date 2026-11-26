-- Un proveedor dice de qué empresa es.
--
-- En Odoo funcionan dos perfiles —POLCECAL (`res.company` 1) y POLYSAN (2)— y
-- en el SdG el padrón de proveedores es uno solo y compartido por los catorce
-- módulos. Esa unificación es deliberada y no se toca: lo que faltaba no era
-- partir el padrón, era que cada proveedor dijera con cuál de las dos trabaja,
-- que hasta hoy sólo se deducía del pedido que lo estaba cotizando.
--
-- ## Por qué dos columnas y no un enum de tres valores
--
-- Es la misma forma que ya tiene `compras_requerimientos` (`empresa_id` +
-- `paga_ambas`), y copiarla tiene una consecuencia concreta: la función que
-- traduce «de qué empresas es esto» a company_ids de Odoo
-- (`empresasDelRequerimiento`, en lib/compras/altaDeProveedor.ts) sirve para
-- las dos puntas sin escribir una segunda que se le parezca. Un enum
-- `('POLCECAL','POLYSAN','AMBAS')` habría metido los nombres de las empresas
-- dentro de un check constraint, que es justo lo que `empresas.odoo_company_id`
-- existe para evitar, y además un valor de enum nuevo viaja solo en su propio
-- archivo (55P04).
--
-- Los tres estados, y el cuarto que importa:
--   (empresa_id null, trabaja_con_ambas false) -> no se sabe
--   (empresa_id = X,  trabaja_con_ambas false) -> sólo X
--   (empresa_id null, trabaja_con_ambas true)  -> las dos
-- El check prohíbe el cuarto, que sería decir las dos cosas a la vez.
--
-- ## Null quiere decir «no se sabe», y no rompe nada
--
-- Quien lo lea cae en el comportamiento de siempre: deducir la empresa del
-- requerimiento que se está cotizando. Por eso las 484 filas pueden quedar en
-- null sin que cambie nada, y por eso el backfill de abajo no adivina.

alter table public.proveedores
  add column if not exists empresa_id uuid references public.empresas (id),
  add column if not exists trabaja_con_ambas boolean not null default false;

alter table public.proveedores
  drop constraint if exists proveedores_empresa_o_ambas;

alter table public.proveedores
  add constraint proveedores_empresa_o_ambas
  check (not (trabaja_con_ambas and empresa_id is not null));

comment on column public.proveedores.empresa_id is
  'La única empresa con la que trabaja este proveedor. Null con trabaja_con_ambas en false quiere decir que no se sabe, y quien lo lea deduce la empresa del requerimiento.';

comment on column public.proveedores.trabaja_con_ambas is
  'Trabaja con las dos empresas. Excluyente con empresa_id por el check proveedores_empresa_o_ambas.';

create index if not exists proveedores_empresa_id_idx
  on public.proveedores (empresa_id)
  where empresa_id is not null;

-- ## El backfill sólo escribe lo que está probado
--
-- `proveedores_odoo` dice en qué perfil de Odoo está cada proveedor. Medido el
-- 24/11/2026 sobre sus 221 filas: 130 proveedores tienen enlace, y de ésos
-- **91 lo tienen en las dos empresas**. Que exista un `res.partner` suyo en los
-- dos perfiles es prueba de que las dos le compraron, así que esos 91 quedan en
-- `trabaja_con_ambas`.
--
-- Los otros 39 —24 sólo en POLCECAL y 15 sólo en POLYSAN— **quedan en null a
-- propósito**. Un enlace en una sola empresa prueba que ésa le compró, no que
-- la otra no pueda: escribir «sólo POLCECAL» ahí sería enlazar al que se le
-- parece, que en este repo es peor que dejar en null, y le cerraría la puerta a
-- POLYSAN sin que nadie lo haya decidido. Null los deja como están hoy.

update public.proveedores p
   set trabaja_con_ambas = true
 where p.empresa_id is null
   and not p.trabaja_con_ambas
   and (select count(distinct po.empresa_id)
          from public.proveedores_odoo po
         where po.proveedor_id = p.id) > 1;
