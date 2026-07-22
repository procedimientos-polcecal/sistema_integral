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
