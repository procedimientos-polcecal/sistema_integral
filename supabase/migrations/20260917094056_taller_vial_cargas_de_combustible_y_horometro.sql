-- ============================================================
-- SdG — Taller Vial: cargas de combustible y horómetro/km (fase 1)
--
-- Requiere que la migración del enum (20260917094035) ya haya corrido y
-- commiteado: acá se nombra 'taller_vial' en tres funciones y en las
-- policies, y un valor de enum recién agregado no se puede usar en la misma
-- transacción (55P04, trampa #1 del README).
--
-- QUÉ REEMPLAZA. La planilla real de Taller Vial (16 pestañas, relevada en
-- vivo el 17/09/2026) tiene su corazón en "DATOS": una fila por carga de
-- combustible, con fecha, equipo, litros y el horómetro (o km, según el
-- equipo) en ese momento — de ahí sale todo lo demás que la planilla calcula
-- (consumo L/h, horas trabajadas, alertas de service por horómetro). Esta
-- migración reproduce sólo eso, que es la primera etapa acordada con el
-- usuario; el resto de la planilla (estados diarios OP/FS/OCF, disponibilidad,
-- checklist de lavado/engrase, choferes) queda para etapas siguientes, igual
-- que las fases de Cantera.
--
-- De acá en adelante manda el SdG: la planilla queda de respaldo y no se
-- carga más desde ahí (misma decisión que Producción, Despacho y Cantera fase
-- 1). El histórico de "DATOS" (759 filas) se importa una sola vez con un
-- script, no con un sync que siga corriendo.
--
-- LOS EQUIPOS YA EXISTEN — SE REUSA `equipos`, NO SE DUPLICA. Los 16 equipos
-- de la planilla (EM1-EM16) ya son filas de `equipos`, cargados por
-- Mantenimiento en el sector "Equipos móviles" (para el costeo de
-- 2026-08-28-costo-total-del-equipo). `equipo_id` referencia esa misma tabla.
--
-- `equipo_id` es NULLABLE y va acompañado de `equipo_raw`: la columna
-- "EQUIPO" de la planilla real no es sólo los 16 códigos — hay filas sueltas
-- como "compresor axerio taller metalurgico" o "empresa piparo" (combustible
-- dado a otra área, no a un equipo móvil). Forzar esas filas a uno de los 16
-- equipos sería la misma trampa que enlazar por parecido; se guardan con
-- `equipo_id` null y se cuentan aparte, igual que un fletero sin resolver en
-- Cantera.
--
-- `lectura` (horómetro u odómetro, según el equipo) es NULLABLE: en la
-- planilla real hay cargas de combustible sin ninguna lectura anotada — pasa
-- seguido con los autoelevadores y las camionetas. Sin dos lecturas
-- consecutivas de un mismo equipo no hay horas/km trabajados que calcular, y
-- eso está bien: se cuenta aparte en vez de inventar un cero.
--
-- SIN COLUMNA DE UNIDAD (horas vs. km) NI DE TIPO DE COMBUSTIBLE EN LA BASE:
-- las dos son una propiedad del EQUIPO (los camiones y camionetas se miden en
-- km, el resto en horas; EM7 y EM9 cargan nafta INFINIA, el resto diesel),
-- no de cada carga — van en un mapa fijo de `lib/tallerVial/equipos.ts`,
-- mismo criterio que `TIPOS_DE_ACARREO` de Cantera. Si un equipo cambia de
-- combustible el mapa se corrige ahí, no acá.
-- ============================================================

-- ── 1. Permisos ──────────────────────────────────────────────
-- Calcadas de las de Cantera (20260910103229): quien tiene el módulo lee,
-- quien puede editar carga combustible, sólo el admin llega a tocar catálogos
-- si el módulo los necesita más adelante.

create or replace function public.tiene_acceso_taller_vial()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    es_admin_sistema() or exists (
      select 1 from usuario_modulos
      where usuario_id = auth.uid()
        and modulo = 'taller_vial'
    ),
    false
  )
$$;

create or replace function public.puede_editar_taller_vial()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    es_admin_sistema() or exists (
      select 1 from usuario_modulos
      where usuario_id = auth.uid()
        and modulo = 'taller_vial'
        and nivel in ('edicion', 'admin')
    ),
    false
  )
$$;

create or replace function public.es_admin_taller_vial()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    es_admin_sistema() or exists (
      select 1 from usuario_modulos
      where usuario_id = auth.uid()
        and modulo = 'taller_vial'
        and nivel = 'admin'
    ),
    false
  )
$$;

-- ── 2. Cargas ────────────────────────────────────────────────

create table if not exists taller_vial_cargas (
  id              uuid primary key default gen_random_uuid(),
  equipo_id       uuid references equipos(id) on delete set null,
  equipo_raw      text not null,
  fecha           date not null,
  litros          numeric not null,
  lectura         numeric,
  observaciones   text,
  cargado_por     uuid references usuarios(id),
  cargado_en      timestamptz not null default now(),
  actualizado_por uuid references usuarios(id),
  actualizado_en  timestamptz
);

comment on table taller_vial_cargas is
  'Una carga de combustible: fecha, equipo, litros y la lectura de horómetro/km en ese momento (nullable, no siempre se anota). Horas/km trabajados y consumo L/h o L/km salen de restar contra la carga anterior del mismo equipo, en lib/tallerVial/combustible.ts — no se guardan.';

create index if not exists taller_vial_cargas_equipo_idx on taller_vial_cargas (equipo_id);
create index if not exists taller_vial_cargas_fecha_idx on taller_vial_cargas (fecha);

alter table taller_vial_cargas enable row level security;

drop policy if exists taller_vial_cargas_select on taller_vial_cargas;
create policy taller_vial_cargas_select on taller_vial_cargas
  for select to authenticated using (tiene_acceso_taller_vial());
drop policy if exists taller_vial_cargas_write on taller_vial_cargas;
create policy taller_vial_cargas_write on taller_vial_cargas
  for all to authenticated using (puede_editar_taller_vial()) with check (puede_editar_taller_vial());

notify pgrst, 'reload schema';
