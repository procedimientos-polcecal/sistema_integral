-- ============================================================
-- SdG — Cantera: acarreo (fase 2 del módulo)
--
-- QUÉ REEMPLAZA. La planilla de balanza/transporte tiene 7500+ pesadas
-- crudas (fecha, bruto, tara, origen, destino) sin fletero — quién hizo cada
-- viaje se reconcilia a mano, fuera de la planilla, y el resultado se tipea
-- una vez por mes en la pestaña "Ingreso de Datos": un renglón por fletero y
-- tipo de material/actividad, con el total del mes. Es exactamente ese nivel
-- —mensual, por fletero y por tipo— el que reproduce esta migración, no el de
-- la pesada individual: modelar cada pesada exigiría además resolver quién la
-- hizo, que hoy nadie carga en ningún lado.
--
-- Misma dirección que la fase 1: manda el SdG. Acá no hay una planilla de la
-- que "dejar de cargar" en el mismo sentido —el acarreo se va a seguir
-- tipeando en algún lado hasta que este módulo lo reemplace—, pero el cálculo
-- de a cuánto le pagás a cada fletero por mes lo hace el sistema, no una
-- fórmula de Sheets.
--
-- LAS TARIFAS CAMBIAN CADA DOS MESES (relevado en la planilla: mar-abr,
-- may-jun, jul-ago tienen números distintos). En vez de una columna por
-- bimestre —lo que obliga a agregar una columna nueva cada dos meses—, cada
-- tarifa tiene una vigencia (`desde`/`hasta`); la vigente en el mes de un
-- acarreo es la que se usa para calcular el monto, y `hasta null` es "sigue
-- vigente".
--
-- `tipo` es texto validado en la app (`lib/cantera/acarreo.ts`), no un enum:
-- son ~19 valores fijos (Dolomita D1, Horas destape, Viaje de bloques, ...),
-- cada uno con su unidad (tonelada/hora/viaje) y, si corresponde, a qué
-- yacimiento de origen mapea — la misma decisión que `cantera_insumos.tipo` en
-- la fase 1, y por la misma razón: un enum nuevo viaja solo en su propia
-- migración (55P04), y acá no hace falta la integridad referencial de un
-- enum para una lista que vive y se documenta en el código.
--
-- "Caliza" es una sola fila en la planilla real aunque puede venir de C1 o de
-- C3 (ambas dan caliza, ya documentado en cantera_yacimientos): por eso no
-- tiene yacimiento fijo en el vocabulario, y el análisis "por yacimiento" la
-- deja afuera en vez de adivinar. Enlazar al que se parece es peor que dejar
-- en null.

create table if not exists cantera_fleteros (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  patente     text,
  activo      boolean not null default true,
  created_at  timestamptz not null default now()
);

comment on table cantera_fleteros is
  'Los fleteros de acarreo (transporte cantera → plantas/reservas). Catálogo aparte de `proveedores`: hoy son 12 y no facturan por Odoo como los contratistas de voladura, así que no comparten tabla con `cantera_contratistas`.';

create table if not exists cantera_tarifas_acarreo (
  id          uuid primary key default gen_random_uuid(),
  tipo        text not null,
  desde       date not null,
  hasta       date,
  tarifa      numeric not null,
  created_at  timestamptz not null default now(),
  -- Dos tarifas del mismo tipo no pueden empezar el mismo día: es lo mínimo
  -- para que la carga por error no deje dos vigentes arrancando juntas. No
  -- impide un solapamiento de rangos (haría falta btree_gist para eso); se
  -- confía en que quien carga una tarifa nueva le pone `hasta` a la anterior,
  -- como ya hace `puede_facturar_cantera` con las listas de una sola vía.
  unique (tipo, desde)
);

comment on table cantera_tarifas_acarreo is
  'Tarifa $/tonelada, $/hora o $/viaje según el tipo, vigente por período — cambian cada dos meses en la planilla real. `hasta null` = vigente.';

create table if not exists cantera_acarreos (
  id                    uuid primary key default gen_random_uuid(),
  fletero_id            uuid not null references cantera_fleteros(id) on delete restrict,
  tipo                  text not null,
  -- Siempre el día 1: es un total mensual, no una fecha de evento.
  mes                   date not null,
  -- En la unidad del tipo (toneladas, horas o viajes) — no kilos como la
  -- planilla vieja, que es justo la clase de confusión que ya costó cara en
  -- bochones (fase 1): acá se define una vez, en `lib/cantera/acarreo.ts`,
  -- para el editor que se carga de acá en más.
  cantidad              numeric not null,
  observaciones         text,
  origen                text not null default 'sdg',
  sheets_pendiente      text,
  sheets_pendiente_en   timestamptz,
  cargado_por           uuid references usuarios(id),
  cargado_en            timestamptz not null default now(),
  actualizado_por       uuid references usuarios(id),
  actualizado_en        timestamptz,
  -- Un fletero, un tipo, un mes: un solo total. Cargar de nuevo el mismo mes
  -- corrige el que ya estaba, no lo duplica — mismo criterio que "una
  -- factura, un registro" de la fase 1.
  unique (fletero_id, tipo, mes)
);

comment on table cantera_acarreos is
  'El total mensual de un fletero en un tipo de material/actividad — el mismo nivel que la pestaña "Ingreso de Datos" de la planilla de balanza. El monto (cantidad × tarifa vigente en `mes`) se calcula al leer, no se guarda.';

create index if not exists cantera_acarreos_mes_idx on cantera_acarreos (mes);
create index if not exists cantera_acarreos_fletero_idx on cantera_acarreos (fletero_id);

alter table cantera_fleteros        enable row level security;
alter table cantera_tarifas_acarreo enable row level security;
alter table cantera_acarreos        enable row level security;

-- Mismas funciones de acceso que ya existen para el resto de Cantera
-- (20260910103229): quien tiene el módulo lee, quien puede editar carga
-- acarreos, sólo el admin toca los catálogos (fleteros y tarifas) — igual que
-- yacimientos e insumos en la fase 1.
drop policy if exists cantera_fleteros_select on cantera_fleteros;
create policy cantera_fleteros_select on cantera_fleteros
  for select to authenticated using (tiene_acceso_cantera());
drop policy if exists cantera_fleteros_write on cantera_fleteros;
create policy cantera_fleteros_write on cantera_fleteros
  for all to authenticated using (es_admin_cantera()) with check (es_admin_cantera());

drop policy if exists cantera_tarifas_acarreo_select on cantera_tarifas_acarreo;
create policy cantera_tarifas_acarreo_select on cantera_tarifas_acarreo
  for select to authenticated using (tiene_acceso_cantera());
drop policy if exists cantera_tarifas_acarreo_write on cantera_tarifas_acarreo;
create policy cantera_tarifas_acarreo_write on cantera_tarifas_acarreo
  for all to authenticated using (es_admin_cantera()) with check (es_admin_cantera());

drop policy if exists cantera_acarreos_select on cantera_acarreos;
create policy cantera_acarreos_select on cantera_acarreos
  for select to authenticated using (tiene_acceso_cantera());
drop policy if exists cantera_acarreos_write on cantera_acarreos;
create policy cantera_acarreos_write on cantera_acarreos
  for all to authenticated using (puede_editar_cantera()) with check (puede_editar_cantera());

notify pgrst, 'reload schema';
