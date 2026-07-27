-- ============================================================
-- 001_nucleo_schema.sql
-- ============================================================
-- ============================================================
-- SdG — Núcleo compartido
-- Entidades base consumidas por RRHH, Mantenimiento y Remises.
-- ============================================================

create extension if not exists "pgcrypto";

-- Rol global del usuario dentro del SdG.
create type user_role as enum ('admin_sistema', 'admin', 'encargado', 'operario');

-- Módulos del sistema.
create type modulo as enum ('rrhh', 'mantenimiento', 'remises');

-- Nivel de acceso de un usuario a un módulo.
create type nivel_acceso as enum ('lectura', 'edicion', 'admin');

-- Empresas del grupo. El "AMBOS" de Mantenimiento NO es una empresa.
create table empresas (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null unique check (nombre in ('POLCECAL', 'POLYSAN')),
  activo     boolean not null default true,
  created_at timestamptz not null default now()
);

-- Sectores. Cada sector pertenece a una empresa (modelo de Mantenimiento).
-- El "sector transversal" de RRHH se resuelve repitiendo el nombre por empresa.
create table sectores (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete restrict,
  nombre     text not null,
  activo     boolean not null default true,
  created_at timestamptz not null default now(),
  unique (empresa_id, nombre)
);

-- Usuarios que inician sesión. Extiende auth.users de Supabase.
create table usuarios (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null unique,
  nombre     text not null,
  apellido   text not null default '',
  rol        user_role not null default 'operario',
  activo     boolean not null default true,
  created_at timestamptz not null default now()
);

-- Qué módulos puede ver/editar cada usuario.
create table usuario_modulos (
  id         uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references usuarios(id) on delete cascade,
  modulo     modulo not null,
  nivel      nivel_acceso not null default 'lectura',
  unique (usuario_id, modulo)
);

-- Fuerza laboral gestionada. NO inicia sesión (salvo enlace opcional futuro).
-- Reúne la ficha rica de RRHH + datos de transporte de Remises.
create table empleados (
  id                     uuid primary key default gen_random_uuid(),
  legajo                 text not null unique,
  nombre                 text not null,
  apellido               text not null,
  empresa_id             uuid not null references empresas(id) on delete restrict,
  sector_id              uuid references sectores(id) on delete set null,
  fecha_ingreso          date not null,
  valor_hora_normal      numeric(12,2) not null default 0,
  horas_teoricas_diarias numeric(5,2) not null default 8,
  -- Datos de transporte (usados por Remises)
  domicilio              text,
  activo                 boolean not null default true,
  created_at             timestamptz not null default now()
);

create index empleados_empresa_idx on empleados (empresa_id);
create index empleados_sector_idx on empleados (sector_id);


-- ============================================================
-- 002_nucleo_rls.sql
-- ============================================================
-- ============================================================
-- SdG — RLS del núcleo
-- ============================================================

-- Rol del usuario actual (bypassa RLS vía security definer).
create or replace function public.rol_actual()
returns user_role
language sql stable security definer set search_path = public
as $$ select rol from usuarios where id = auth.uid() $$;

-- ¿El usuario actual es admin del sistema o admin general?
create or replace function public.es_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select rol in ('admin_sistema', 'admin') from usuarios where id = auth.uid()),
    false
  )
$$;

alter table empresas        enable row level security;
alter table sectores        enable row level security;
alter table usuarios        enable row level security;
alter table usuario_modulos enable row level security;
alter table empleados       enable row level security;

-- empresas: cualquier usuario autenticado lee; solo admin escribe.
create policy empresas_select on empresas for select to authenticated using (true);
create policy empresas_write  on empresas for all    to authenticated using (es_admin()) with check (es_admin());

-- sectores: igual.
create policy sectores_select on sectores for select to authenticated using (true);
create policy sectores_write  on sectores for all    to authenticated using (es_admin()) with check (es_admin());

-- usuarios: cada uno se ve a sí mismo; admin ve/escribe todos.
create policy usuarios_select_self  on usuarios for select to authenticated using (id = auth.uid() or es_admin());
create policy usuarios_write_admin  on usuarios for all    to authenticated using (es_admin()) with check (es_admin());

-- usuario_modulos: el usuario ve sus grants; admin gestiona todos.
create policy um_select on usuario_modulos for select to authenticated using (usuario_id = auth.uid() or es_admin());
create policy um_write  on usuario_modulos for all    to authenticated using (es_admin()) with check (es_admin());

-- empleados: autenticado lee; solo admin escribe (los módulos afinarán esto luego).
create policy empleados_select on empleados for select to authenticated using (true);
create policy empleados_write  on empleados for all    to authenticated using (es_admin()) with check (es_admin());


-- ============================================================
-- 003_seed_nucleo.sql
-- ============================================================
-- ============================================================
-- SdG — Seed del núcleo (empresas y sectores base)
-- Idempotente: se puede correr varias veces sin duplicar.
-- ============================================================

insert into empresas (nombre) values ('POLCECAL'), ('POLYSAN')
on conflict (nombre) do nothing;

-- Sectores base por empresa (ajustar a la realidad del grupo).
insert into sectores (empresa_id, nombre)
select e.id, s.nombre
from empresas e
cross join (values ('Calidad'), ('Producción'), ('Mantenimiento'), ('Administración')) as s(nombre)
on conflict (empresa_id, nombre) do nothing;


-- ============================================================
-- 004_nucleo_ajustes_mantenimiento.sql
-- ============================================================
-- ============================================================
-- SdG — Ajustes al núcleo para admitir el módulo Mantenimiento
-- ============================================================

-- Estado operativo de planta/sector (ACTIVA / PARADA / EN_REPARACION).
create type plant_status as enum ('ACTIVA', 'PARADA', 'EN_REPARACION');

-- ¿El usuario actual puede editar dentro del módulo Mantenimiento?
-- Admin global, o usuario_modulos(mantenimiento) con nivel edicion/admin.
create or replace function public.puede_editar_mantenimiento()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    es_admin() or exists (
      select 1 from usuario_modulos
      where usuario_id = auth.uid()
        and modulo = 'mantenimiento'
        and nivel in ('edicion', 'admin')
    ),
    false
  )
$$;

-- ¿El usuario actual tiene acceso al módulo Mantenimiento (cualquier nivel)?
-- Usado para operaciones que en la app original hacía "cualquier autenticado"
-- (registrar ejecuciones, avanzar next_date) — acá se acota a miembros del módulo.
create or replace function public.tiene_acceso_mantenimiento()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    es_admin() or exists (
      select 1 from usuario_modulos
      where usuario_id = auth.uid()
        and modulo = 'mantenimiento'
    ),
    false
  )
$$;

-- Empresas: estado operativo (lo usa Mantenimiento; no afecta a RRHH).
alter table empresas add column status plant_status not null default 'ACTIVA';

create table empresa_status_log (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  old_status plant_status,
  new_status plant_status not null,
  reason     text,
  changed_by uuid references usuarios(id),
  changed_at timestamptz not null default now()
);

alter table empresa_status_log enable row level security;
create policy empresa_status_log_select on empresa_status_log for select to authenticated using (true);
create policy empresa_status_log_write  on empresa_status_log for all    to authenticated using (puede_editar_mantenimiento()) with check (puede_editar_mantenimiento());

-- Permite cambiar el estado de una empresa desde el módulo Mantenimiento
-- sin requerir admin global del SdG (se suma a la policy "empresas_write" de 002).
create policy empresas_update_mantenimiento on empresas for update to authenticated using (puede_editar_mantenimiento()) with check (puede_editar_mantenimiento());

-- Sectores: soportar sectores transversales a ambas empresas
-- (reemplaza la planta "AMBOS" de Mantenimiento, que no es una empresa real).
alter table sectores
  alter column empresa_id drop not null,
  add column transversal boolean not null default false,
  add column status plant_status not null default 'ACTIVA';

alter table sectores
  add constraint sectores_empresa_o_transversal check ((empresa_id is not null) <> transversal);

-- unique(empresa_id, nombre) de 001 no cubre transversales (empresa_id null permite
-- múltiples nulls) — se evita duplicar nombre entre sectores transversales aparte.
create unique index sectores_transversal_nombre_key on sectores (nombre) where transversal;

create table sectores_status_log (
  id         uuid primary key default gen_random_uuid(),
  sector_id  uuid not null references sectores(id) on delete cascade,
  old_status plant_status,
  new_status plant_status not null,
  reason     text,
  changed_by uuid references usuarios(id),
  changed_at timestamptz not null default now()
);

alter table sectores_status_log enable row level security;
create policy sectores_status_log_select on sectores_status_log for select to authenticated using (true);
create policy sectores_status_log_write  on sectores_status_log for all    to authenticated using (puede_editar_mantenimiento()) with check (puede_editar_mantenimiento());

create policy sectores_update_mantenimiento on sectores for update to authenticated using (puede_editar_mantenimiento()) with check (puede_editar_mantenimiento());


-- ============================================================
-- 005_mantenimiento_schema.sql
-- ============================================================
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


-- ============================================================
-- 006_mantenimiento_rls.sql
-- ============================================================
-- ============================================================
-- SdG — Módulo Mantenimiento: RLS + storage
-- ============================================================

alter table equipos                    enable row level security;
alter table equipos_checklists         enable row level security;
alter table mantenimientos_programados enable row level security;
alter table mantenimientos_ejecuciones enable row level security;
alter table equipos_status_log         enable row level security;
alter table ordenes_trabajo            enable row level security;
alter table planificacion_diaria       enable row level security;
alter table planificacion_diaria_items enable row level security;

-- equipos / checklists / status_log: lectura abierta, escritura gateada.
create policy equipos_select on equipos for select to authenticated using (true);
create policy equipos_write  on equipos for all    to authenticated using (puede_editar_mantenimiento()) with check (puede_editar_mantenimiento());

create policy equipos_checklists_select on equipos_checklists for select to authenticated using (true);
create policy equipos_checklists_write  on equipos_checklists for all    to authenticated using (puede_editar_mantenimiento()) with check (puede_editar_mantenimiento());

create policy equipos_status_log_select on equipos_status_log for select to authenticated using (true);
create policy equipos_status_log_write  on equipos_status_log for all    to authenticated using (puede_editar_mantenimiento()) with check (puede_editar_mantenimiento());

-- mantenimientos_programados: cualquier miembro del módulo puede actualizar
-- (necesario al registrar una ejecución, que avanza next_date); crear/borrar
-- programaciones requiere nivel de edición.
create policy mp_select on mantenimientos_programados for select to authenticated using (true);
create policy mp_update on mantenimientos_programados for update to authenticated using (tiene_acceso_mantenimiento()) with check (tiene_acceso_mantenimiento());
create policy mp_insert on mantenimientos_programados for insert to authenticated with check (puede_editar_mantenimiento());
create policy mp_delete on mantenimientos_programados for delete to authenticated using (puede_editar_mantenimiento());

-- mantenimientos_ejecuciones: cualquier miembro del módulo puede registrar una
-- ejecución; editar/borrar una ya registrada requiere nivel de edición.
create policy me_select on mantenimientos_ejecuciones for select to authenticated using (true);
create policy me_insert on mantenimientos_ejecuciones for insert to authenticated with check (tiene_acceso_mantenimiento());
create policy me_update on mantenimientos_ejecuciones for update to authenticated using (puede_editar_mantenimiento()) with check (puede_editar_mantenimiento());
create policy me_delete on mantenimientos_ejecuciones for delete to authenticated using (puede_editar_mantenimiento());

-- ordenes_trabajo / planificacion_diaria: lectura abierta, escritura gateada.
create policy ot_select on ordenes_trabajo for select to authenticated using (true);
create policy ot_write  on ordenes_trabajo for all    to authenticated using (puede_editar_mantenimiento()) with check (puede_editar_mantenimiento());

create policy pd_select on planificacion_diaria for select to authenticated using (true);
create policy pd_write  on planificacion_diaria for all    to authenticated using (puede_editar_mantenimiento()) with check (puede_editar_mantenimiento());

create policy pdi_select on planificacion_diaria_items for select to authenticated using (true);
create policy pdi_write  on planificacion_diaria_items for all    to authenticated using (puede_editar_mantenimiento()) with check (puede_editar_mantenimiento());

-- ── Storage: fotos de ejecuciones y de referencia de mantenimientos ────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'execution-photos',
  'execution-photos',
  false,
  10485760,
  array['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic']
)
on conflict (id) do nothing;

-- Acotado a miembros del módulo (el original lo dejaba abierto a cualquier
-- autenticado, aceptable en una app standalone; acá el login es compartido con
-- RRHH/Remises, así que se restringe).
create policy mantenimiento_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'execution-photos' and tiene_acceso_mantenimiento());

create policy mantenimiento_photos_select on storage.objects for select to authenticated
  using (bucket_id = 'execution-photos' and tiene_acceso_mantenimiento());

-- DELETE: cubre fotos de ejecución ({uid}/...) y fotos de referencia
-- ({schedules}/{scheduleId}/...) — el original sólo cubría el primer patrón,
-- lo que dejaba las fotos de referencia imborrables por policy.
create policy mantenimiento_photos_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'execution-photos'
    and (
      auth.uid()::text = (storage.foldername(name))[1]
      or ((storage.foldername(name))[1] = 'schedules' and puede_editar_mantenimiento())
    )
  );


-- ============================================================
-- 007_seed_mantenimiento.sql
-- ============================================================
-- ============================================================
-- SdG — Seed de prueba del módulo Mantenimiento
-- Idempotente: se puede correr varias veces sin duplicar.
-- Usa el sector "Mantenimiento" ya sembrado por empresa en 003_seed_nucleo.
-- ============================================================

insert into equipos (sector_id, name, code, power_kw, criticality)
select s.id, 'Compresor A1', 'PO-A1-01', 55, 'ALTA'
from sectores s
join empresas e on e.id = s.empresa_id
where e.nombre = 'POLCECAL' and s.nombre = 'Mantenimiento'
and not exists (select 1 from equipos where code = 'PO-A1-01');

insert into equipos (sector_id, name, code, power_kw, criticality)
select s.id, 'Cinta transportadora B1', 'PY-B1-01', 15, 'MEDIA'
from sectores s
join empresas e on e.id = s.empresa_id
where e.nombre = 'POLYSAN' and s.nombre = 'Mantenimiento'
and not exists (select 1 from equipos where code = 'PY-B1-01');

insert into equipos_checklists (equipment_id, name, items, is_active)
select eq.id, 'Checklist mensual',
  '[{"id":"1","label":"Nivel de aceite","type":"check","required":true},
    {"id":"2","label":"Temperatura de trabajo","type":"number","required":false,"unit":"°C"}]'::jsonb,
  true
from equipos eq
where eq.code = 'PO-A1-01'
and not exists (select 1 from equipos_checklists where equipment_id = eq.id);

insert into mantenimientos_programados (equipment_id, checklist_id, maintenance_type, schedule_type, next_date, description)
select eq.id, ch.id, 'Lubricacion', 'MENSUAL', current_date + interval '15 days', 'Lubricación mensual de rodamientos'
from equipos eq
join equipos_checklists ch on ch.equipment_id = eq.id
where eq.code = 'PO-A1-01'
and not exists (select 1 from mantenimientos_programados where equipment_id = eq.id);


