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
--
-- CORRECCIÓN SOBRE LA PRIMERA VERSIÓN DE ESTE ARCHIVO (todavía no corrida):
-- el usuario aclaró que las toneladas de material SÍ tienen fletero, pesada
-- por pesada, en la pestaña "Datos" — lo que no tenía la primera lectura
-- era la columna bien indexada (ver más abajo). Por eso se agrega
-- `cantera_pesadas`: el material (Dolomita D1, Chocolata 3, ...) se cuenta
-- solo desde ahí, agrupando por fletero+tipo+mes; sólo las tres actividades
-- sin pesada (Horas destape, Viaje de bloques, Hora movimiento bochones
-- pozo) se siguen cargando a mano en `cantera_acarreos`.
--
-- LA COLUMNA DEL FLETERO EN "Datos" ESTÁ CORRIDA UNA POSICIÓN RESPECTO DE SU
-- TÍTULO: la columna que dice "FechaArchivo" en el encabezado trae en
-- realidad el nombre del fletero ("Amaray", "Dumerauf 1 (SQV 625)", ...), y
-- la que dice "OrigenArchivo" trae una fecha. Verificado leyendo filas
-- reales, no sólo el encabezado — el mismo tipo de trampa que ya costó
-- "Pozos"/"Metros Perf." invertidos en BOCHONES. `lib/cantera/pesadas.ts`
-- lee por esa posición real, con un comentario que no se puede pasar por
-- alto.
--
-- LOS NOMBRES DE FLETERO EN "Datos" SON UN DESORDEN (30 variantes para 12
-- fleteros: con y sin patente entre paréntesis, "Dumerauf" a secas para dos
-- camiones distintos, "Priola2", "CONTE"/"Conte Gaston" que ni siquiera está
-- en el catálogo). `normalizarFletero()` resuelve por patente primero —es
-- inequívoca— y por nombre sólo cuando el fletero tiene un solo camión
-- conocido; un nombre a secas que puede ser más de uno ("Dumerauf", "Orsatti"
-- sin número) queda sin fletero en vez de adivinar cuál.

create table if not exists cantera_pesadas (
  id            uuid primary key default gen_random_uuid(),
  fecha         date not null,
  hora          text,
  bruto         numeric,
  tara          numeric,
  -- El tipo de `lib/cantera/acarreo.ts` que corresponde a la columna de
  -- material que tenía el neto en esa fila ("dolomita_d1", "caliza", ...), o
  -- null para columnas sin tipo tarifado (los "Destape ..." de la planilla,
  -- que son sobrecarga y no piedra vendible).
  tipo          text,
  -- Bruto - Tara de esa fila, en toneladas (la planilla lo da en kilos).
  toneladas     numeric not null,
  origen        text,
  destino       text,
  -- El texto tal como está en la planilla, para poder auditar un fletero_id
  -- null contra lo que decía la fila real.
  fletero_raw   text,
  fletero_id    uuid references cantera_fleteros(id) on delete set null,
  created_at    timestamptz not null default now()
);

comment on table cantera_pesadas is
  'Una pesada de balanza (una fila de la pestaña "Datos"): fecha, material, origen/destino y fletero. De acá sale, agrupando por fletero+tipo+mes, cuánto acarreó cada uno en materiales — las tres actividades sin pesada (destape, bloques, bochones) no están acá, van en cantera_acarreos.';

create index if not exists cantera_pesadas_fecha_idx on cantera_pesadas (fecha);
create index if not exists cantera_pesadas_fletero_idx on cantera_pesadas (fletero_id);
create index if not exists cantera_pesadas_tipo_idx on cantera_pesadas (tipo);

create table if not exists cantera_fleteros (
  id          uuid primary key default gen_random_uuid(),
  -- Único para que el import histórico pueda hacer upsert por nombre sin
  -- duplicar al re-correrlo.
  nombre      text not null unique,
  patente     text,
  activo      boolean not null default true,
  created_at  timestamptz not null default now()
);

comment on table cantera_fleteros is
  'Los fleteros de acarreo (transporte cantera → plantas/reservas). Catálogo aparte de `proveedores`: hoy son 11 y no facturan por Odoo como los contratistas de voladura, así que no comparten tabla con `cantera_contratistas`.';

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
  'El total mensual de un fletero en una actividad sin pesada (horas de destape, viajes de bloques, horas de bochones) — los materiales con pesada van en cantera_pesadas y se suman solos. El monto (cantidad × tarifa vigente en `mes`) se calcula al leer, no se guarda.';

create index if not exists cantera_acarreos_mes_idx on cantera_acarreos (mes);
create index if not exists cantera_acarreos_fletero_idx on cantera_acarreos (fletero_id);

alter table cantera_fleteros        enable row level security;
alter table cantera_tarifas_acarreo enable row level security;
alter table cantera_acarreos        enable row level security;
alter table cantera_pesadas         enable row level security;

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

-- Las pesadas se cargan por import (service role, que no pasa por RLS), no
-- fila por fila desde una pantalla — por eso el write queda en admin y no en
-- "puede editar", a diferencia de cantera_acarreos.
drop policy if exists cantera_pesadas_select on cantera_pesadas;
create policy cantera_pesadas_select on cantera_pesadas
  for select to authenticated using (tiene_acceso_cantera());
drop policy if exists cantera_pesadas_write on cantera_pesadas;
create policy cantera_pesadas_write on cantera_pesadas
  for all to authenticated using (es_admin_cantera()) with check (es_admin_cantera());

notify pgrst, 'reload schema';
