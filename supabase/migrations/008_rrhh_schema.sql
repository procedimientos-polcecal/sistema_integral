-- ============================================================
-- SdG — Módulo RRHH: esquema de dominio
-- Portado de github.com/delfinapuch3/APPRRHH (Prisma/Postgres),
-- reapuntado al núcleo compartido.
-- ============================================================

create type origen_fichada as enum ('IMPORTADO', 'MANUAL');

create type tipo_dia as enum ('HABIL', 'SABADO', 'DOMINGO', 'FERIADO');

create type tipo_ausencia as enum (
  'LICENCIA_ART', 'VACACIONES', 'LICENCIA_GREMIAL', 'PERMISO_PERSONAL',
  'ENFERMEDAD_ACCIDENTE_INCULPABLE', 'LICENCIA_SIN_GOCE_SUELDO', 'SUSPENSION',
  'FALLECIMIENTO_FAMILIAR', 'EXAMEN_ESTUDIO', 'TARDANZA', 'INJUSTIFICADA', 'OTRA'
);

create type estado_franco as enum ('PENDIENTE', 'TOMADO');

create type tipo_liquidacion as enum ('QUINCENAL', 'MENSUAL');

create type estado_liquidacion as enum ('BORRADOR', 'CERRADA');

create type tipo_feriado as enum ('NACIONAL', 'PROVINCIAL', 'PUENTE');

-- ── rrhh_empleados_datos ─────────────────────────────────
-- Campos de la ficha de empleado que no son de interés para otros módulos
-- (Mantenimiento/Remises), por eso no viven en el núcleo `empleados`.
create table rrhh_empleados_datos (
  empleado_id                uuid primary key references empleados(id) on delete cascade,
  sindicato                  text,
  fecha_nacimiento           date,
  genero                     text,
  escala_vacaciones_override jsonb
);

-- ── jornadas ─────────────────────────────────────────────
-- Catálogo de turnos posibles. No se asignan a un empleado: cada día el
-- motor detecta cuál es el más parecido a la marcación real.
create table jornadas (
  id                  uuid primary key default gen_random_uuid(),
  nombre              text not null,
  hora_inicio         text not null,
  hora_fin            text not null,
  tolerancia_minutos  integer not null default 15,
  activo              boolean not null default true,
  created_at          timestamptz not null default now()
);

-- ── rrhh_import_batches ──────────────────────────────────
create table rrhh_import_batches (
  id                  uuid primary key default gen_random_uuid(),
  nombre_archivo      text not null,
  usuario_id          uuid not null references usuarios(id),
  cantidad_registros  integer not null default 0,
  cantidad_errores    integer not null default 0,
  log_detalle         text,
  created_at          timestamptz not null default now()
);

-- ── rrhh_import_staging ──────────────────────────────────
-- Reemplaza el cache en memoria (Map + TTL) del preview de importación del
-- original — necesario en un entorno serverless con múltiples instancias.
create table rrhh_import_staging (
  id          uuid primary key default gen_random_uuid(),
  usuario_id  uuid not null references usuarios(id),
  tipo        text not null check (tipo in ('empleados', 'fichadas')),
  token       text not null unique default encode(gen_random_bytes(24), 'hex'),
  datos       jsonb not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '15 minutes'
);

create index rrhh_import_staging_expires_idx on rrhh_import_staging (expires_at);

-- ── fichadas ─────────────────────────────────────────────
-- `fecha` = día calendario (sin componente horario, sin ambigüedad de TZ).
-- `hora_entrada`/`hora_salida` = instante real (timestamptz).
create table fichadas (
  id               uuid primary key default gen_random_uuid(),
  empleado_id      uuid not null references empleados(id) on delete cascade,
  fecha            date not null,
  hora_entrada     timestamptz not null,
  hora_salida      timestamptz,
  origen           origen_fichada not null default 'MANUAL',
  import_batch_id  uuid references rrhh_import_batches(id),
  observaciones    text,
  created_at       timestamptz not null default now()
);

create index fichadas_empleado_fecha_idx on fichadas (empleado_id, fecha);

-- ── feriados ─────────────────────────────────────────────
create table feriados (
  id      uuid primary key default gen_random_uuid(),
  fecha   date not null unique,
  nombre  text not null,
  tipo    tipo_feriado not null default 'NACIONAL'
);

-- ── config_liquidacion ───────────────────────────────────
-- Singleton (una sola fila, id=1) con las reglas de cálculo editables.
create table config_liquidacion (
  id                          integer primary key default 1 check (id = 1),
  horas_normales_por_dia      numeric(5,2) not null default 8,
  hora_corte_sabado           text not null default '12:00',
  multiplicador_extra_50      numeric(4,2) not null default 1.5,
  multiplicador_extra_100     numeric(4,2) not null default 2.0,
  horas_franco_compensatorio  numeric(5,2) not null default 8,
  feriado_como_domingo        boolean not null default true,
  escala_vacaciones           jsonb not null default
    '[{"hastaAnios":5,"dias":14},{"hastaAnios":10,"dias":21},{"hastaAnios":20,"dias":28},{"hastaAnios":999,"dias":35}]'::jsonb
);

insert into config_liquidacion (id) values (1) on conflict (id) do nothing;

-- ── calculos_diarios ─────────────────────────────────────
-- Resultado del motor de cálculo, una fila por empleado/día.
create table calculos_diarios (
  id                 uuid primary key default gen_random_uuid(),
  empleado_id        uuid not null references empleados(id) on delete cascade,
  fecha              date not null,
  tipo_dia           tipo_dia not null,
  horas_normales     numeric(5,2) not null default 0,
  horas_extra_50     numeric(5,2) not null default 0,
  horas_extra_100    numeric(5,2) not null default 0,
  franco_generado    boolean not null default false,
  ausente            boolean not null default false,
  justificada        boolean,
  tipo_ausencia      tipo_ausencia,
  observaciones      text,
  extras_validadas   boolean not null default false,
  validado_por_id    uuid references usuarios(id),
  fecha_validacion   timestamptz,
  horas_manual       boolean not null default false,
  tarde              boolean not null default false,
  retiro_anticipado  boolean not null default false,
  updated_at         timestamptz not null default now(),
  unique (empleado_id, fecha)
);

create index calculos_diarios_fecha_idx on calculos_diarios (fecha);

create trigger calculos_diarios_updated_at
  before update on calculos_diarios
  for each row execute function set_updated_at();

-- ── ausencias ────────────────────────────────────────────
create table ausencias (
  id               uuid primary key default gen_random_uuid(),
  empleado_id      uuid not null references empleados(id) on delete cascade,
  fecha_desde      date not null,
  fecha_hasta      date not null,
  tipo             tipo_ausencia not null,
  justificada      boolean not null default true,
  observaciones    text,
  cargado_por_id   uuid not null references usuarios(id),
  created_at       timestamptz not null default now()
);

create index ausencias_empleado_idx on ausencias (empleado_id);
create index ausencias_rango_idx on ausencias (fecha_desde, fecha_hasta);

-- ── vacaciones ───────────────────────────────────────────
create table vacaciones (
  id                    uuid primary key default gen_random_uuid(),
  empleado_id           uuid not null references empleados(id) on delete cascade,
  anio_correspondiente  integer not null,
  fecha_desde           date not null,
  fecha_hasta           date not null,
  dias_tomados          integer not null,
  observaciones         text,
  created_at            timestamptz not null default now()
);

create index vacaciones_empleado_idx on vacaciones (empleado_id);

-- ── francos ──────────────────────────────────────────────
create table francos (
  id              uuid primary key default gen_random_uuid(),
  empleado_id     uuid not null references empleados(id) on delete cascade,
  fecha_generado  date not null,
  horas           numeric(5,2) not null default 8,
  estado          estado_franco not null default 'PENDIENTE',
  fecha_tomado    date,
  created_at      timestamptz not null default now()
);

create index francos_empleado_idx on francos (empleado_id);
create index francos_estado_idx on francos (estado);

-- ── liquidaciones ────────────────────────────────────────
create table liquidaciones (
  id                uuid primary key default gen_random_uuid(),
  empleado_id       uuid not null references empleados(id) on delete cascade,
  tipo              tipo_liquidacion not null,
  fecha_desde       date not null,
  fecha_hasta       date not null,
  horas_normales    numeric(7,2) not null default 0,
  horas_extra_50    numeric(7,2) not null default 0,
  horas_extra_100   numeric(7,2) not null default 0,
  monto_normal      numeric(12,2) not null default 0,
  monto_extra_50    numeric(12,2) not null default 0,
  monto_extra_100   numeric(12,2) not null default 0,
  total_bruto       numeric(12,2) not null default 0,
  estado            estado_liquidacion not null default 'BORRADOR',
  generado_por_id   uuid not null references usuarios(id),
  created_at        timestamptz not null default now()
);

create index liquidaciones_empleado_idx on liquidaciones (empleado_id);
create index liquidaciones_estado_idx on liquidaciones (estado);
