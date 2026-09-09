-- ============================================================
-- SdG — Inventario: los equipos del pañol
--
-- EL PROBLEMA. El formulario de movimientos no tiene campo de equipo y el
-- kardex de la planilla sí: es su columna K. Está viva —580 de 4.174 filas la
-- traen cargada, incluidas las del 7 y el 8 de septiembre— y los siete
-- movimientos que se cargaron desde la app quedaron con esa celda vacía.
--
-- CÓMO FUNCIONA ESA COLUMNA. No es texto libre: un `onEdit` de Apps Script le
-- arma un desplegable dependiente del sector de la J, con los equipos de la
-- pestaña `Sectores/Equipos` —columna A el sector, columna B el equipo—. 255
-- pares, 26 sectores, y ningún equipo repetido en dos sectores: es un equipo
-- con su sector al lado.
--
-- POR QUÉ EL NOMBRE NO SE ARMA CON EL DEL NÚCLEO. De esos 255, 19 no tienen
-- código en `equipos` —los once oficios que la pestaña usa de relleno, más
-- `PO-C1-11 - EDIFICIO`, `D1`, `D6`, `LA ALCANCIA` y `GALPON 1/2/3/5`— y **26
-- comparten el código con otro nombre**: `EM8` es "SCANIA 420 4x4" en la
-- planilla y "CAMIÓN VOLCADOR 1" acá; `PY-A2-14` es "EMBOLSADORA" allá y
-- "FLUIDOR 7" acá. Armar el texto desde el núcleo escribiría en la K 26 valores
-- que el desplegable no ofrece. El nombre se guarda literal y el núcleo se usa
-- para enganchar por código, que es lo único que las dos puntas escriben igual.
--
-- POR QUÉ NO SE SIEMBRAN LOS 255 ACÁ. La pestaña es una pestaña hecha para
-- leerse, así que la lista se espeja de ella en cada sincronización en vez de
-- administrarse por pantalla. Sembrarla en SQL sería una segunda copia que
-- envejece sola. La contra, dicha: entre que esta migración se aplica y que
-- alguien aprieta "Traer de la planilla", el select no tiene nada que ofrecer.
-- ============================================================

-- ── Los seis destinos que faltaban ───────────────────────────
--
-- La validación de la columna J (`Empleados!D2:D28`) acepta 27 valores y
-- `inventario_destinos` tenía 21. Los seis que faltan tienen entre ellos 23
-- equipos en la pestaña, que sin un destino donde colgarse el select nunca
-- podría ofrecer.
--
-- Es exactamente la contra que la 20260903090920 dejó anotada —"si el pañol
-- agrega a alguien a la validación de la planilla y nadie lo carga acá, la app
-- no se entera"— cobrada por primera vez.

insert into inventario_destinos (nombre) values
  ('PLANTA TRITURACIÓN 2'),
  ('FILLER 3'),
  ('COMPRESORES'),
  ('CAPATACES'),
  ('BALANZA'),
  ('GALPONES')
on conflict (nombre) do nothing;

-- El sector del núcleo, para los que son uno. De los seis lo son dos: `Filler
-- 3` y `Compresores` están en `sectores`; `PLANTA TRITURACIÓN 2`, `CAPATACES`,
-- `BALANZA` y `GALPONES` no, y quedan en null a propósito — igual que MECÁNICO
-- y TALLER VIAL de la siembra original.
--
-- `having count(*) = 1` es lo que hace que un nombre repetido en `sectores`
-- quede en null en vez de engancharse al azar: hay dos sectores llamados
-- "Mantenimiento" y dos "Producción". Y el valor se saca con
-- `(array_agg(id))[1]` porque Postgres no tiene `min()` para uuid — eso hizo
-- revertir la 20260903090920 entera sin dejar rastro.

update inventario_destinos d
   set sector_id = (
         select (array_agg(s.id))[1]
           from sectores s
          where s.activo
            and upper(s.nombre) = upper(d.nombre)
         having count(*) = 1
       ),
       updated_at = now()
 where d.sector_id is null
   and d.nombre in (
     'PLANTA TRITURACIÓN 2', 'FILLER 3', 'COMPRESORES',
     'CAPATACES', 'BALANZA', 'GALPONES'
   );

-- ── La lista de equipos ──────────────────────────────────────

create table if not exists inventario_equipos (
  id           uuid primary key default gen_random_uuid(),
  -- Tal cual está en la columna B de `Sectores/Equipos`. Es lo que la app va a
  -- escribir en la K, y por eso no se normaliza ni se pasa a mayúsculas: tiene
  -- que ser un valor que el desplegable de la planilla ofrezca.
  nombre       text not null unique,
  -- El sector de la columna A. `not null` y `restrict`: un equipo sin destino no
  -- lo puede ofrecer nadie, así que borrar un destino con equipos colgados tiene
  -- que fallar en vez de dejar filas mudas. Los pares cuyo sector no es un
  -- destino conocido no entran: la sincronización los informa.
  destino_id   uuid not null references inventario_destinos(id) on delete restrict,
  -- El equipo del núcleo, cuando se lo reconoce **por código**. NULL en los 19
  -- que no son equipos: los oficios de relleno, los galpones y `D1`/`D6`.
  equipment_id uuid references equipos(id) on delete set null,
  -- Lo que desaparece de la pestaña se desactiva; no se borra. Los movimientos
  -- históricos le apuntan, y una lista vaciada por un error de lectura sería un
  -- select vacío que nadie relaciona con la sincronización.
  activo       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists inventario_equipos_destino_idx
  on inventario_equipos (destino_id);

-- `drop` antes de `create`: Postgres no tiene `create trigger if not exists`, y
-- sin esto correr la migración dos veces falla con "trigger already exists" —y
-- como el editor de Supabase envuelve el script en una transacción, ese error
-- revierte TODO, incluidas las tablas. Se ve igual que si nunca hubiera corrido.
drop trigger if exists inventario_equipos_updated_at on inventario_equipos;
create trigger inventario_equipos_updated_at
  before update on inventario_equipos
  for each row execute function set_updated_at();

comment on table inventario_equipos is
  'El vocabulario de la columna K del kardex: para qué máquina salió el material. Es el espejo de la pestaña `Sectores/Equipos` de la planilla, que es de donde el `onEdit` arma el desplegable dependiente del sector. Se re-lee en cada sincronización; no se administra por pantalla.';
comment on column inventario_equipos.nombre is
  'Literal la columna B de la pestaña. No se normaliza: es lo que la app escribe en la K y tiene que ser un valor que el desplegable ofrezca. `EM8` es "SCANIA 420 4x4" acá y "CAMIÓN VOLCADOR 1" en `equipos`, y son 26 así.';
comment on column inventario_equipos.equipment_id is
  'El equipo del núcleo, enganchado por código. NULL en los 19 valores que la pestaña usa y no son equipos —PAÑOL, MECÁNICO, GALPON 5, D6— y que no tienen por qué serlo.';

-- ── El movimiento apunta a la lista ──────────────────────────
--
-- `equipo_raw` y `equipment_id` ya existen desde la 046. `equipo_raw` guarda el
-- texto —el de la planilla cuando viene de allá, el de la lista cuando lo carga
-- la app— y es de donde el kardex de la app lee el equipo; esto es el enlace, y
-- es lo que permite preguntar "cuánto se gastó en el molino vertical", que
-- `equipment_id` sí puede contestar y `equipo_raw` no sin resolver texto.

alter table inventario_movimientos
  add column if not exists equipo_id uuid references inventario_equipos(id) on delete set null;

create index if not exists inventario_mov_equipo_idx
  on inventario_movimientos (equipo_id) where equipo_id is not null;

-- ── RLS ──────────────────────────────────────────────────────
--
-- Sólo lectura para la app. A diferencia de `inventario_destinos` y
-- `inventario_solicitantes`, esta lista **no se edita desde el navegador**: la
-- escribe la sincronización con la service role, que no pasa por RLS. Sin
-- política de escritura, un POST directo a la tabla no puede meter un nombre
-- que la validación de la planilla no acepte. Si algún día hay ABM, la política
-- se agrega entonces.

alter table inventario_equipos enable row level security;

drop policy if exists inventario_equipos_select on inventario_equipos;
create policy inventario_equipos_select on inventario_equipos
  for select to authenticated using (tiene_acceso_inventario());

-- ── Que PostgREST vea la tabla nueva ─────────────────────────
--
-- La app no habla con Postgres sino con PostgREST, que guarda el esquema en
-- caché. Normalmente Supabase se lo recarga solo al terminar un DDL, pero no
-- siempre: hasta que lo haga, cada consulta responde "Could not find the table
-- 'public.inventario_equipos' in the schema cache", que se lee como si la
-- migración no hubiera corrido.
notify pgrst, 'reload schema';
