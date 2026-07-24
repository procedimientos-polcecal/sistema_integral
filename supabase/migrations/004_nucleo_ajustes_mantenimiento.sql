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
