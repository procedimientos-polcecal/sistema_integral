-- ============================================================
-- SdG — Taller Vial: services por horómetro (250 / 500 / 1000 / 2000 hs)
--
-- A DIFERENCIA de las cargas de combustible y los estados diarios, esto NO es
-- un espejo: el usuario pidió poder cargarlo desde el SdG. La planilla real
-- ("SERVICE") sólo tiene el estado calculado del último/próximo service, no
-- un registro cargable de cada intervención — acá se guarda el evento
-- (cuándo se hizo cada service, a qué horómetro) y el "próximo vencimiento"
-- se calcula al leer, en `lib/tallerVial/service.ts`.
--
-- CASCADA, CONFIRMADO CON EL USUARIO: hacer el service de 1000 hs también
-- cuenta como hecho el de 500 y el de 250 en ese mismo horómetro — es el
-- patrón estándar de mantenimiento por escalones (el de 2000 incluye a los
-- tres chicos, el de 1000 a los dos más chicos, etc.). Por eso `tier` es un
-- número simple y la cascada se resuelve leyendo, no guardando cuatro filas
-- por cada carga.
--
-- `tier` es un entero validado en la app (`TIERS_DE_SERVICE` en
-- lib/tallerVial/service.ts: 250, 500, 1000, 2000) y no un enum ni una FK a
-- catálogo — son cuatro valores fijos que no van a cambiar, mismo criterio
-- que `tipo` en `cantera_acarreos`.
--
-- SIN `horometro_actual`: el horómetro con el que se compara "cuánto falta"
-- no se guarda acá — sale de la lectura más reciente de
-- `taller_vial_cargas`, que ya se sincroniza sola desde la planilla de
-- combustible. Guardar un segundo horómetro dejaría dos números que se
-- pueden desincronizar sin que nada avise.
-- ============================================================

create table if not exists taller_vial_services (
  id            uuid primary key default gen_random_uuid(),
  equipo_id     uuid not null references equipos(id) on delete cascade,
  tier          integer not null,
  fecha         date not null,
  horometro     numeric not null,
  observaciones text,
  cargado_por   uuid references usuarios(id),
  cargado_en    timestamptz not null default now()
);

comment on table taller_vial_services is
  'Un service realizado a un equipo, a un horómetro y en un intervalo (250/500/1000/2000 hs) — se carga desde la app. El próximo vencimiento de cada intervalo, con cascada (uno grande cubre a los chicos), se calcula en lib/tallerVial/service.ts.';

create index if not exists taller_vial_services_equipo_idx on taller_vial_services (equipo_id);

alter table taller_vial_services enable row level security;

-- Esto sí se carga desde una pantalla, así que el write queda en "puede
-- editar" y no en admin — a diferencia de las cargas de combustible y los
-- estados diarios, que entran por import.
drop policy if exists taller_vial_services_select on taller_vial_services;
create policy taller_vial_services_select on taller_vial_services
  for select to authenticated using (tiene_acceso_taller_vial());
drop policy if exists taller_vial_services_write on taller_vial_services;
create policy taller_vial_services_write on taller_vial_services
  for all to authenticated using (puede_editar_taller_vial()) with check (puede_editar_taller_vial());

notify pgrst, 'reload schema';
