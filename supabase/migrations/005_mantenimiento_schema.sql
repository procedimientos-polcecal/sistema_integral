-- ============================================================
-- SdG — Módulo Mantenimiento: esquema de dominio
-- Portado de github.com/procedimientos-polcecal/mantenimiento
-- (migraciones 001-016), reapuntado al núcleo compartido.
-- ============================================================

create type equipment_status as enum (
  'OPERATIVO', 'EN_MANTENIMIENTO', 'EN_REPARACION',
  'STANDBY', 'FUERA_DE_SERVICIO', 'DADO_DE_BAJA'
);

create type criticality_level as enum ('ALTA', 'MEDIA', 'BAJA');

create type maintenance_type as enum (
  'Lubricacion', 'Inspeccion', 'Limpieza',
  'Ajuste', 'Reemplazo', 'Revision_electrica', 'Otro'
);

create type schedule_type as enum (
  'DIARIO', 'SEMANAL', 'QUINCENAL', 'MENSUAL',
  'TRIMESTRAL', 'SEMESTRAL', 'ANUAL', 'PERSONALIZADO', 'FECHA_FIJA'
);

create type schedule_status as enum ('active', 'paused', 'cancelled', 'completed');

-- ── equipos ──────────────────────────────────────────────
create table equipos (
  id           uuid primary key default gen_random_uuid(),
  sector_id    uuid not null references sectores(id),
  name         text not null,
  code         text not null unique,
  power_kw     numeric(10,2),
  description  text,
  status       equipment_status not null default 'OPERATIVO',
  criticality  criticality_level not null default 'MEDIA',
  notes        text,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index equipos_sector_idx on equipos (sector_id);
create index equipos_status_idx on equipos (status);
create index equipos_code_idx on equipos (code);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger equipos_updated_at
  before update on equipos
  for each row execute function set_updated_at();

-- ── equipos_checklists ───────────────────────────────────
create table equipos_checklists (
  id                uuid primary key default gen_random_uuid(),
  equipment_id      uuid not null references equipos(id),
  maintenance_type  maintenance_type,
  version           integer not null default 1,
  items             jsonb not null default '[]'::jsonb,
  created_by        uuid references usuarios(id),
  created_at        timestamptz not null default now(),
  is_active         boolean not null default true,
  name              text
);

create index ec_equipment_idx on equipos_checklists (equipment_id);

-- ── mantenimientos_programados ───────────────────────────
create table mantenimientos_programados (
  id                uuid primary key default gen_random_uuid(),
  equipment_id      uuid not null references equipos(id),
  checklist_id      uuid references equipos_checklists(id),
  maintenance_type  maintenance_type not null,
  schedule_type     schedule_type not null,
  interval_days     integer,
  next_date         date not null,
  assigned_to       uuid references usuarios(id),
  status            schedule_status not null default 'active',
  created_by        uuid references usuarios(id),
  created_at        timestamptz not null default now(),
  last_executed_at  timestamptz,
  description       text,
  estimated_hours   numeric(5,2),
  reference_photos  jsonb default '[]'::jsonb
);

create index mp_equipment_idx on mantenimientos_programados (equipment_id);
create index mp_assigned_idx on mantenimientos_programados (assigned_to);
create index mp_next_date_idx on mantenimientos_programados (next_date);
create index mp_status_idx on mantenimientos_programados (status);

-- ── mantenimientos_ejecuciones ───────────────────────────
-- Limpieza respecto del original: se descartan `status` (enum legacy nunca escrito
-- por la app) y `photos_start`/`photos_end`/`drive_folder_url` (reemplazados por
-- `photo_urls`, nunca usados).
create table mantenimientos_ejecuciones (
  id                    uuid primary key default gen_random_uuid(),
  schedule_id           uuid references mantenimientos_programados(id),
  equipment_id          uuid references equipos(id),
  assigned_to           uuid references usuarios(id),
  started_at            timestamptz,
  completed_at          timestamptz,
  checklist_responses   jsonb default '[]'::jsonb,
  notes_start           text,
  notes_end             text,
  synced_at             timestamptz,
  created_at            timestamptz not null default now(),
  photo_urls            jsonb default '[]'::jsonb,
  checklist_snapshot    jsonb,
  execution_status      text check (execution_status in ('completado', 'parcial', 'cancelado')),
  executed_at           timestamptz default now(),
  duration_hours        numeric(5,2),
  observations          text,
  executed_by           uuid references usuarios(id)
);

create index me_schedule_idx on mantenimientos_ejecuciones (schedule_id);
create index me_assigned_idx on mantenimientos_ejecuciones (assigned_to);

-- ── equipos_status_log ───────────────────────────────────
create table equipos_status_log (
  id            uuid primary key default gen_random_uuid(),
  equipment_id  uuid not null references equipos(id),
  old_status    equipment_status,
  new_status    equipment_status not null,
  changed_by    uuid references usuarios(id),
  changed_at    timestamptz not null default now(),
  reason        text
);

create index esl_equipment_idx on equipos_status_log (equipment_id);

-- ── ordenes_trabajo ──────────────────────────────────────
-- `estado`/`tipo`/`quien` quedan TEXT libre: en el origen los enums ot_estado/
-- ot_tipo/ot_quien se crearon pero nunca se aplicaron a estas columnas, y la app
-- usa valores (ej. "SUSPENDIDA") que ni siquiera están en ot_estado.
create table ordenes_trabajo (
  id               uuid primary key default gen_random_uuid(),
  ot_number        integer not null unique,
  fecha            date,
  sector_raw       text,
  equipo_raw       text,
  equipo_code      text,
  equipment_id     uuid references equipos(id),
  especialidad     text,
  tipo             text,
  quien            text,
  descripcion      text,
  repuesto         text,
  fecha_ejecucion  date,
  fecha_cierre     date,
  estado           text not null default 'POR_HACER',
  contratista      text,
  horas            numeric,
  operario_1       text,
  operario_2       text,
  operario_3       text,
  prioridad        text,
  synced_at        timestamptz not null default now(),
  app_created      boolean not null default false,
  sheets_row       integer,
  sector_id        uuid references sectores(id),
  created_by       uuid references usuarios(id),
  created_at_app   timestamptz,
  schedule_id      uuid references mantenimientos_programados(id) on delete set null
);

create index ot_equipment_idx on ordenes_trabajo (equipment_id);
create index ot_estado_idx on ordenes_trabajo (estado);
create index ot_code_idx on ordenes_trabajo (equipo_code);
create index ot_schedule_idx on ordenes_trabajo (schedule_id);

-- Al cambiar el estado de una OT, refleja el estado del equipo asociado
-- (versión corregida: evita la condición de carrera del trigger original).
create or replace function public.sync_equipos_status_from_ot()
returns trigger
language plpgsql
security definer
as $$
declare
  eq_id          uuid;
  new_eq_status  equipment_status;
  cur_eq_status  equipment_status;
begin
  eq_id := new.equipment_id;
  if eq_id is null then return new; end if;

  case new.estado
    when 'REALIZADO'  then new_eq_status := 'OPERATIVO';
    when 'EN_PROCESO' then new_eq_status := 'EN_MANTENIMIENTO';
    else return new;
  end case;

  select status into cur_eq_status from equipos where id = eq_id;
  if cur_eq_status = new_eq_status then return new; end if;

  update equipos set status = new_eq_status where id = eq_id;

  insert into equipos_status_log (equipment_id, old_status, new_status, reason, changed_by)
  values (
    eq_id,
    cur_eq_status,
    new_eq_status,
    'Actualizado automáticamente por OT #' || new.ot_number,
    null
  );

  return new;
end;
$$;

create trigger ot_auto_equipment_status
  after insert or update of estado on ordenes_trabajo
  for each row execute function sync_equipos_status_from_ot();

-- ── planificacion_diaria ─────────────────────────────────
create table planificacion_diaria (
  id          uuid primary key default gen_random_uuid(),
  fecha       date not null,
  titulo      text,
  notas       text,
  created_by  uuid references usuarios(id),
  created_at  timestamptz not null default now()
);

create index pd_fecha_idx on planificacion_diaria (fecha desc);

create table planificacion_diaria_items (
  id               uuid primary key default gen_random_uuid(),
  plan_id          uuid not null references planificacion_diaria(id) on delete cascade,
  work_order_id    uuid references ordenes_trabajo(id),
  ot_number        integer,
  especialidad     text,
  sector_raw       text,
  equipo_raw       text,
  descripcion      text,
  repuesto         text,
  fecha_ejecucion  date,
  assigned_to      uuid references usuarios(id),
  assigned_name    text,
  notas_item       text,
  orden            integer not null default 0,
  created_at       timestamptz not null default now()
);

create index pdi_plan_idx on planificacion_diaria_items (plan_id);
