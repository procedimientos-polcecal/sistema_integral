-- ============================================================
-- SdG — Compras: catálogo de "dónde se necesita"
--
-- La 017 guardaba la ubicación como texto libre más un enlace opcional a
-- sectores/equipos por requerimiento. En la práctica no sirve:
--
--   * Los `sectores` del núcleo son organizativos (Calidad, Finanzas), no
--     lugares físicos, así que ninguna de las 38 ubicaciones de la planilla
--     cruza contra ellos.
--   * `equipos` todavía tiene datos de prueba, no la flota real.
--   * Con texto libre no hay filtro por ubicación, y `Pañol` (292 RI) o
--     `Taller eléctrico` (147 RI) se llenan de variantes mal tipeadas apenas
--     la gente empieza a cargar.
--
-- Se pasa a un catálogo propio. El enlace al núcleo vive en el catálogo y no
-- en cada requerimiento: cuando se cargue la flota real hay que mapear 38
-- filas una vez, no 1825.
-- ============================================================

create table if not exists compras_ubicaciones (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null unique,
  tipo       text,                       -- planta | taller | equipo | oficina | otra
  -- Enriquecimiento opcional contra el núcleo. Hoy quedan en null; se completan
  -- cuando existan los sectores físicos y la flota real de equipos.
  sector_id  uuid references sectores(id) on delete set null,
  equipo_id  uuid references equipos(id) on delete set null,
  orden      integer not null default 100,
  activo     boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists compras_ubicaciones_activo_idx on compras_ubicaciones (activo) where activo;

alter table compras_requerimientos
  add column if not exists ubicacion_id uuid references compras_ubicaciones(id) on delete set null;

create index if not exists compras_req_ubicacion_idx on compras_requerimientos (ubicacion_id);

-- ── Semilla: las 38 ubicaciones de la planilla ───────────────
-- Se cargan con su tipo para poder agruparlas en los informes. Si ya se
-- importó el histórico, el bloque siguiente suma cualquier valor extra que
-- haya aparecido.
insert into compras_ubicaciones (nombre, tipo, orden) values
  ('Pañol',                      'taller',  10),
  ('Taller eléctrico',           'taller',  20),
  ('Taller de mantenimiento',    'taller',  30),
  ('Taller de equipos móviles',  'taller',  40),
  ('Planta de trituración 1',    'planta',  50),
  ('Planta de trituración 2',    'planta',  60),
  ('Planta de trituración 3',    'planta',  70),
  ('Planta Filler 1',            'planta',  80),
  ('Planta Filler 2',            'planta',  90),
  ('Planta 0-2mm',               'planta', 100),
  ('Molienda de cal',            'planta', 110),
  ('Molienda filler 1',          'planta', 120),
  ('Molienda filler 2',          'planta', 130),
  ('Molienda 0-2mm',             'planta', 140),
  ('Calcinación',                'planta', 150),
  ('Hidratación',                'planta', 160),
  ('Compresores',                'planta', 170),
  ('Cantera',                    'planta', 180),
  ('Laboratorio',                'oficina',190),
  ('Oficinas',                   'oficina',200),
  ('Vigilancia',                 'oficina',210),
  ('OTRA',                       'otra',   900)
on conflict (nombre) do nothing;

-- Cualquier ubicación que haya venido del histórico y no esté en la semilla
-- (equipos móviles concretos, sobre todo) se da de alta automáticamente.
insert into compras_ubicaciones (nombre, tipo, orden)
select distinct
       r.ubicacion_raw,
       case
         when r.ubicacion_raw ~* '^(Planta|Molienda|Hidrataci|Calcinaci)' then 'planta'
         when r.ubicacion_raw ~* '^(Taller|Pa.ol)'                        then 'taller'
         when r.ubicacion_raw ~* '^(Oficina|Laboratorio|Vigilancia)'      then 'oficina'
         when r.ubicacion_raw ~* '(CAT |Doosan|Autoelevador|Scania|Liu Gong|Regador|Amarok|Compresor)' then 'equipo'
         else 'otra'
       end,
       500
from compras_requerimientos r
where r.ubicacion_raw is not null
  and btrim(r.ubicacion_raw) <> ''
on conflict (nombre) do nothing;

-- ── Enganchar los requerimientos ya importados ───────────────
update compras_requerimientos r
set ubicacion_id = u.id
from compras_ubicaciones u
where r.ubicacion_id is null
  and r.ubicacion_raw is not null
  and lower(btrim(r.ubicacion_raw)) = lower(btrim(u.nombre));

-- ── Baja de las columnas que reemplaza el catálogo ───────────
-- El enlace al núcleo pasa a estar en compras_ubicaciones. Tenerlo además por
-- requerimiento sólo abría la puerta a que los dos lados se contradigan.
alter table compras_requerimientos drop column if exists sector_id;
alter table compras_requerimientos drop column if exists equipo_id;

comment on column compras_requerimientos.ubicacion_raw is
  'Texto original de la planilla. Se conserva como respaldo: ubicacion_id es el dato bueno.';

-- ── RLS ──────────────────────────────────────────────────────
alter table compras_ubicaciones enable row level security;

drop policy if exists compras_ubicaciones_select on compras_ubicaciones;
create policy compras_ubicaciones_select on compras_ubicaciones
  for select to authenticated using (true);

drop policy if exists compras_ubicaciones_write on compras_ubicaciones;
create policy compras_ubicaciones_write on compras_ubicaciones
  for all to authenticated
  using (puede_editar_compras())
  with check (puede_editar_compras());
