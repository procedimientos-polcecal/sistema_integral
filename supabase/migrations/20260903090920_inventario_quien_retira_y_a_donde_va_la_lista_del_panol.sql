-- ============================================================
-- SdG — Quién retira y a dónde va: la lista del pañol
--
-- EL PROBLEMA. El formulario de movimientos ofrecía los 69 empleados del padrón
-- y los 39 sectores del núcleo, y el kardex de la planilla usa otra lista: 64
-- nombres, cada uno con su destino, que es la validación que el pañol tiene
-- puesta en las columnas F y J. Las dos listas se parecen lo suficiente para
-- confundir y difieren lo suficiente para romper:
--
--   · 59 de los 64 nombres están en el padrón. Los otros 5 son tres
--     contratistas, "REGULADOR" —que no es una persona— y MENGUILLO, que sí
--     está pero cargado como "MENGUILLO, MARCEL DANIE".
--   · 10 empleados activos NO están en la lista del pañol, casi todos de
--     oficinas. Uno es ORTIZ, FACUNDO JOEL: el primer movimiento que se cargó
--     desde la app quedó con un nombre que la validación de la planilla no
--     acepta.
--   · De los 21 destinos, sólo 5 coinciden con un sector del núcleo.
--
-- Y ESE ÚLTIMO NÚMERO ES EL FONDO DEL ASUNTO. Lo que la planilla llama "SECTOR"
-- no es un sector: es a dónde va el material o qué oficio lo retira. MECÁNICO,
-- ELECTRICISTA y LUBRICADOR no son lugares de la planta, son personas haciendo
-- un trabajo. Meterlos en `sectores` sería meterlos en RRHH, Mantenimiento,
-- Remises y Compras, que comparten esa tabla. Por eso el vocabulario del pañol
-- vive acá, en su módulo, y `sectores` queda como está.
--
-- LO QUE SE DECIDIÓ. La lista es del SdG y se edita en el SdG, sembrada con los
-- 64 que la planilla tiene hoy. No se lee de la planilla: es un catálogo
-- estable —cambia cuando entra o se va alguien—, no un flujo de datos como el
-- kardex. La contra, dicha para que se sepa: si el pañol agrega a alguien a la
-- validación de la planilla y nadie lo carga acá, la app no se entera. La
-- pantalla de la lista es lo que hace que eso sea un trámite de diez segundos.
--
-- Los nombres van **exactamente** como están en la validación, incluido
-- "STRUPP , Bernardo Miguel" con el espacio de más antes de la coma. Corregirlo
-- acá haría que la app escriba en la columna F un valor que la planilla
-- rechaza. El espacio se ignora al comparar contra el padrón, así que no impide
-- reconocerlo; lo que hay que arreglar es la planilla, y entonces esto.
-- ============================================================

-- ── A dónde va el material ───────────────────────────────────

create table if not exists inventario_destinos (
  id         uuid primary key default gen_random_uuid(),
  -- Tal cual se escribe en la columna J. Es lo que la app va a escribir ahí, y
  -- por eso no se normaliza ni se pasa a minúsculas.
  nombre     text not null unique,
  -- El sector del núcleo, cuando el destino es uno. De 21 destinos lo son 5:
  -- el resto son oficios y lugares que `sectores` no tiene y no debería tener.
  sector_id  uuid references sectores(id) on delete set null,
  activo     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger inventario_destinos_updated_at
  before update on inventario_destinos
  for each row execute function set_updated_at();

comment on table inventario_destinos is
  'El vocabulario de la columna J del kardex: a dónde va el material o qué oficio lo retira. No son sectores —MECÁNICO y LUBRICADOR son oficios— y por eso no viven en la tabla `sectores`, que comparten los cinco módulos.';
comment on column inventario_destinos.sector_id is
  'El sector del núcleo cuando el destino es uno, para poder cruzar con los otros módulos. NULL cuando no lo es o cuando el nombre es ambiguo: hay dos sectores llamados "Mantenimiento" y dos "Producción", y elegir uno al azar pondría el gasto en el lugar que no es.';

-- ── Quién retira ─────────────────────────────────────────────

create table if not exists inventario_solicitantes (
  id          uuid primary key default gen_random_uuid(),
  -- Tal cual se escribe en la columna F.
  nombre      text not null unique,
  -- Su destino habitual: es de donde el formulario completa "para qué sector"
  -- solo, y se puede pisar movimiento por movimiento.
  destino_id  uuid references inventario_destinos(id) on delete set null,
  -- El empleado del padrón, cuando se lo reconoce. NULL para los contratistas
  -- y para "REGULADOR", que no son empleados y no tienen por qué serlo.
  empleado_id uuid references empleados(id) on delete set null,
  activo      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists inventario_solicitantes_destino_idx
  on inventario_solicitantes (destino_id);

create trigger inventario_solicitantes_updated_at
  before update on inventario_solicitantes
  for each row execute function set_updated_at();

comment on table inventario_solicitantes is
  'El vocabulario de la columna F del kardex: quién puede retirar. No es `empleados` —incluye contratistas y "REGULADOR", y le faltan 10 empleados de oficinas— pero se engancha con él cuando el nombre se reconoce.';

-- ── El movimiento apunta a los dos ───────────────────────────
--
-- `sector_raw`/`solicitante` siguen guardando el texto: es lo que la planilla
-- dice y lo que se puede leer sin resolver nada. Estos dos son el enlace, y son
-- lo que permite preguntar "cuánto se llevó MECÁNICO en agosto" — que `sector_id`
-- no puede contestar, porque MECÁNICO no es un sector.

alter table inventario_movimientos
  add column if not exists solicitante_id uuid references inventario_solicitantes(id) on delete set null,
  add column if not exists destino_id     uuid references inventario_destinos(id) on delete set null;

create index if not exists inventario_mov_destino_idx
  on inventario_movimientos (destino_id) where destino_id is not null;

-- ── Los 21 destinos que la planilla usa hoy ──────────────────

insert into inventario_destinos (nombre) values
  ('CALCINACIÓN'), ('CANTERA'), ('CONSTRUCTORA'), ('CONTRATISTA'),
  ('DESPACHO CAL'), ('ELECTRICISTA'), ('FILLER 1'), ('FILLER 2'),
  ('HIDRATACIÓN'), ('LABORATORIO'), ('LUBRICADOR'), ('MANTENIMIENTO'),
  ('MECÁNICO'), ('MOLIENDA DE CAL'), ('OFICINAS'), ('PAÑOL'),
  ('PLANTA 0-2'), ('PLANTA TRITURACIÓN 1'), ('PLANTA TRITURACIÓN 3'),
  ('PRODUCCIÓN'), ('TALLER VIAL')
on conflict (nombre) do nothing;

-- El enlace al núcleo se hace **sólo cuando hay una única coincidencia**. Da 5:
-- CALCINACIÓN, DESPACHO CAL, FILLER 1, FILLER 2 e HIDRATACIÓN. MANTENIMIENTO y
-- PRODUCCIÓN quedan en null aunque el nombre exista, porque existe dos veces:
-- `sectores` tiene duplicados sin resolver ("Administración", "Calidad",
-- "Mantenimiento" y "Producción" están dos veces cada uno) y elegir el primero
-- pondría el consumo en el sector equivocado la mitad de las veces. Los otros
-- 14 no son sectores. Todos se pueden enlazar a mano desde la pantalla de la
-- lista, que es donde alguien que los conoce puede decidirlo.
update inventario_destinos d
   set sector_id = u.id
  from (
    select lower(nombre) as clave, min(id) as id
      from sectores
     group by lower(nombre)
    having count(*) = 1
  ) u
 where u.clave = lower(d.nombre)
   and d.sector_id is null;

-- ── Los 64 nombres, con su destino ───────────────────────────

insert into inventario_solicitantes (nombre, destino_id)
select v.nombre, d.id
  from (values
    ('ROSSI, Nicolas Javier',              'OFICINAS'),
    ('STRUPP , Bernardo Miguel',           'PAÑOL'),
    ('CEJAS, Mario Agustin',               'CALCINACIÓN'),
    ('SANDOVAL, Miguel Angel',             'CALCINACIÓN'),
    ('SANDOVAL, Matias Ezequiel',          'CALCINACIÓN'),
    ('RODRIGUEZ, Enzo Martin',             'CALCINACIÓN'),
    ('GAVIATTI, Esteban Ricardo',          'CALCINACIÓN'),
    ('MILIA, Pablo Ramiro',                'CANTERA'),
    ('FOURCADE, Luna',                     'CANTERA'),
    ('TAIBO, Ruben Dario',                 'CANTERA'),
    ('ANDRADA, Juan Jose',                 'CANTERA'),
    ('BECKER, Jorge Enrique',              'CANTERA'),
    ('FARIAS, Alberto Martin',             'CANTERA'),
    ('BELTRAMELLA, Hector Fabián',         'CANTERA'),
    ('BRAVO, Guillermo Raul',              'DESPACHO CAL'),
    ('LOPEZ, Rodrigo Argentino',           'DESPACHO CAL'),
    ('VELAZQUEZ, Carlos Nestor',           'DESPACHO CAL'),
    ('DOLEZOR, Diego Matias',              'DESPACHO CAL'),
    ('GALLASTEGUI, Fabricio',              'DESPACHO CAL'),
    ('ROJAS, Andres Damian',               'DESPACHO CAL'),
    ('BECKER, Miqueas Andres',             'DESPACHO CAL'),
    ('AGUIRRE, Jorge Alfredo',             'DESPACHO CAL'),
    ('LUNA, Gustavo Alfredo',              'FILLER 1'),
    ('RECOFSKY, Juan Pedro',               'FILLER 1'),
    ('RAMALLO, Nestor Fabian',             'FILLER 1'),
    ('FERNANDEZ, Claudio Dario',           'FILLER 2'),
    ('BECKER, Marcelo Baltazar',           'FILLER 2'),
    ('CHACON, Martin Oscar',               'FILLER 2'),
    ('ARRIETA, Sandro Juan A',             'HIDRATACIÓN'),
    ('VARELA, Francisco Enrique',          'MANTENIMIENTO'),
    ('LOPEZ, Raul Argentino',              'MECÁNICO'),
    ('AGUIRRE, Gabriel Hernan',            'MECÁNICO'),
    ('GARCIA ARIAS, Geronimo',             'ELECTRICISTA'),
    ('PICART, Roberto Orlando',            'ELECTRICISTA'),
    ('AGOSTA, Horacio',                    'ELECTRICISTA'),
    ('ECHEVERRIA, Nestor Daniel',          'MECÁNICO'),
    ('GALLASTEGUI, Lucas',                 'LUBRICADOR'),
    ('PIPARO, Lautaro Agustin',            'MECÁNICO'),
    ('MENDIZABAL, Lucas Ezequiel',         'MECÁNICO'),
    ('CEJAS, Alejandro Antonio',           'MOLIENDA DE CAL'),
    ('MARTEL, Juan Manuel',                'MOLIENDA DE CAL'),
    ('CEJAS, Raul Humberto',               'MOLIENDA DE CAL'),
    ('CEJAS, Franco Agustin',              'MOLIENDA DE CAL'),
    ('ROMAN, Luis Alberto',                'PLANTA 0-2'),
    ('NAHUELQUIR, Federico',               'PLANTA 0-2'),
    ('ROMAN MAIBACH, Alejandro Emilio',    'PLANTA 0-2'),
    ('SANDOVAL, Martin Adrian',            'PRODUCCIÓN'),
    ('SANDOVAL, Victor',                   'PRODUCCIÓN'),
    ('PETTACHI, Leonardo',                 'PRODUCCIÓN'),
    ('LUNA, Gustavo Alfredo Hijo',         'PLANTA TRITURACIÓN 3'),
    ('MENGUILLO, Marcelo Daniel',          'PLANTA TRITURACIÓN 1'),
    ('FERNANDEZ, Carlos Abel',             'PLANTA TRITURACIÓN 1'),
    ('PICART, Jose Luis',                  'TALLER VIAL'),
    ('GALLO TRAVERS, Gonzalo Raul',        'TALLER VIAL'),
    ('LENZETTI, Maximiliano',              'PAÑOL'),
    ('Omar Piparo',                        'CONTRATISTA'),
    ('Augusto Candia',                     'CONTRATISTA'),
    ('Mariano Const',                      'CONSTRUCTORA'),
    ('GUIDO, Marcelo Fabian',              'CONSTRUCTORA'),
    ('REGULADOR',                          'PAÑOL'),
    ('SHTEFEC KUSZMIRUK, Karen Jeannett',  'OFICINAS'),
    ('BENITEZ, Mayra Maiten',              'LABORATORIO'),
    ('GARNICA, Alejandro',                 'LABORATORIO'),
    ('FERNANDEZ, Rocco',                   'MANTENIMIENTO')
  ) as v(nombre, destino)
  join inventario_destinos d on d.nombre = v.destino
on conflict (nombre) do nothing;

-- El `empleado_id` NO se resuelve acá. Comparar "GALLASTEGUI, Fabricio" con las
-- columnas `nombre` y `apellido` del padrón requiere la misma normalización que
-- ya vive en `lib/inventario/enlaces.ts` —sin acentos, sin comas, espacios
-- colapsados, y probando el nombre en los dos órdenes—, y tenerla escrita dos
-- veces es cómo las dos copias se separan. Lo hace `reconciliarSolicitantes()`,
-- que corre con cada sincronización y es idempotente: los que quedan en null
-- son los que de verdad no están en el padrón.

-- ── RLS ──────────────────────────────────────────────────────
--
-- Editar la lista requiere nivel de **edición** y no admin, al revés que el ABM
-- de artículos. Es a propósito: quien nota que falta alguien es quien está
-- cargando el movimiento y no puede terminarlo, y hacerlo esperar a un admin
-- para agregar un nombre termina en que carga con otro nombre parecido — que es
-- justo lo que este catálogo viene a evitar.

alter table inventario_destinos      enable row level security;
alter table inventario_solicitantes  enable row level security;

drop policy if exists inventario_destinos_select on inventario_destinos;
create policy inventario_destinos_select on inventario_destinos
  for select to authenticated using (tiene_acceso_inventario());

drop policy if exists inventario_destinos_write on inventario_destinos;
create policy inventario_destinos_write on inventario_destinos
  for all to authenticated
  using (puede_editar_inventario())
  with check (puede_editar_inventario());

drop policy if exists inventario_solicitantes_select on inventario_solicitantes;
create policy inventario_solicitantes_select on inventario_solicitantes
  for select to authenticated using (tiene_acceso_inventario());

drop policy if exists inventario_solicitantes_write on inventario_solicitantes;
create policy inventario_solicitantes_write on inventario_solicitantes
  for all to authenticated
  using (puede_editar_inventario())
  with check (puede_editar_inventario());
