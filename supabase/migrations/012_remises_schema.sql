-- ============================================================
-- SdG — Módulo Remises: esquema de dominio
-- Portado de github.com/procedimientos-polcecal/remisgest
-- (vanilla JS + Firebase/Firestore), reapuntado al núcleo compartido.
-- ============================================================

-- Vínculo opcional: un login del núcleo puede corresponder a un empleado
-- (auto-servicio "Mi remis" — empleados en general NO inician sesión, ver
-- comentario en 001_nucleo_schema.sql; este es justamente el "enlace
-- opcional futuro" que ya anticipaba).
alter table usuarios add column empleado_id uuid references empleados(id) on delete set null;

create type remises_tipo_hoja as enum ('ida', 'vuelta');

-- ── choferes ─────────────────────────────────────────────
-- No existe como entidad propia en el original (era texto libre sobre
-- vehicles.driver/.phone) — se normaliza acá.
create table choferes (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null,
  telefono   text,
  activo     boolean not null default true,
  created_at timestamptz not null default now()
);

-- ── vehiculos ────────────────────────────────────────────
create table vehiculos (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null,
  capacidad  integer not null default 8,
  chofer_id  uuid references choferes(id) on delete set null,
  activo     boolean not null default true,
  created_at timestamptz not null default now()
);

-- ── remises_turnos ───────────────────────────────────────
-- Catálogo de turnos (Mañana/Tarde/Noche). Nombre distinto de `jornadas`
-- (RRHH) para no mezclar conceptos: acá un turno es una franja horaria de
-- transporte, no un horario de fichaje.
create table remises_turnos (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  hora_inicio text not null,
  hora_fin    text not null,
  color       text not null default '#059669',
  activo      boolean not null default true
);

-- ── remises_empleados_datos ──────────────────────────────
-- Campos de recogida propios de Remises. `direccion` puede diferir de
-- `empleados.domicilio` (núcleo) si el punto de encuentro real no es la
-- casa del empleado.
create table remises_empleados_datos (
  empleado_id      uuid primary key references empleados(id) on delete cascade,
  direccion        text,
  lat              numeric,
  lng              numeric,
  turno_default_id uuid references remises_turnos(id) on delete set null
);

-- ── remises_asistencia ───────────────────────────────────
-- Reemplaza attendance[key][] (array en el blob) por filas reales.
create table remises_asistencia (
  empleado_id uuid not null references empleados(id) on delete cascade,
  fecha       date not null,
  turno_id    uuid not null references remises_turnos(id) on delete cascade,
  primary key (empleado_id, fecha, turno_id)
);

-- ── remises_plan_semana ──────────────────────────────────
-- Roster de planificación semanal, independiente de la asistencia real del
-- día ("Semana" es un borrador que se copia a remises_asistencia al generar).
create table remises_plan_semana (
  empleado_id uuid not null references empleados(id) on delete cascade,
  fecha       date not null,
  turno_id    uuid not null references remises_turnos(id) on delete cascade,
  tipo        remises_tipo_hoja not null,
  primary key (empleado_id, fecha, turno_id, tipo)
);

-- ── hojas_ruta ───────────────────────────────────────────
-- Una fila por vehículo/fecha/turno/tipo generada (ex "route" del blob).
create table hojas_ruta (
  id          uuid primary key default gen_random_uuid(),
  fecha       date not null,
  turno_id    uuid not null references remises_turnos(id),
  tipo        remises_tipo_hoja not null,
  vehiculo_id uuid not null references vehiculos(id),
  -- Snapshot del chofer al generar: si después se reasigna el chofer del
  -- vehículo, esta hoja histórica no cambia retroactivamente.
  chofer_id   uuid references choferes(id),
  hora_salida text,
  km          numeric(6,1),
  minutos     integer,
  geometria   jsonb,
  created_at  timestamptz not null default now()
);

create index hojas_ruta_fecha_idx on hojas_ruta (fecha, turno_id, tipo);

-- ── asientos ─────────────────────────────────────────────
-- Reemplaza tanto route.stops (denormalizado) como route.seats (roto en el
-- original — nunca se completaba). Única fuente para tarjetas de ruta,
-- exportación, vista "Mi remis" del empleado y notificación push.
create table asientos (
  id           uuid primary key default gen_random_uuid(),
  hoja_ruta_id uuid not null references hojas_ruta(id) on delete cascade,
  empleado_id  uuid not null references empleados(id),
  orden        integer not null,
  unique (hoja_ruta_id, empleado_id)
);

create index asientos_empleado_idx on asientos (empleado_id);

-- ── remises_plantillas ───────────────────────────────────
create table remises_plantillas (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null,
  tipo       remises_tipo_hoja not null,
  turno_id   uuid not null references remises_turnos(id),
  created_at timestamptz not null default now()
);

create table remises_plantillas_grupos (
  id           uuid primary key default gen_random_uuid(),
  plantilla_id uuid not null references remises_plantillas(id) on delete cascade,
  vehiculo_id  uuid not null references vehiculos(id),
  empleado_id  uuid not null references empleados(id),
  unique (plantilla_id, vehiculo_id, empleado_id)
);

-- ── remises_config ───────────────────────────────────────
-- Singleton, mismo patrón que config_liquidacion (RRHH).
create table remises_config (
  id                integer primary key default 1 check (id = 1),
  fabrica_nombre    text not null default 'Fábrica',
  fabrica_direccion text,
  fabrica_lat       numeric,
  fabrica_lng       numeric,
  velocidad_kmh     numeric(5,1) not null default 40,
  ciudad_referencia text
);

insert into remises_config (id) values (1) on conflict (id) do nothing;

-- ── remises_push_tokens ──────────────────────────────────
-- Suscripción Web Push estándar (reemplaza fcmTokens de Firebase).
create table remises_push_tokens (
  usuario_id uuid primary key references usuarios(id) on delete cascade,
  endpoint   text not null,
  p256dh     text not null,
  auth       text not null,
  updated_at timestamptz not null default now()
);
