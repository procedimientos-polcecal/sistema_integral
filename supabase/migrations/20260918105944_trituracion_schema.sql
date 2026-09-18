-- ============================================================
-- SdG — Trituración: catálogo de plantas + el parte diario (fase 1)
--
-- Requiere que la migración del enum (20260918105935) ya haya corrido y
-- commiteado: acá se nombra 'trituracion' en tres funciones y en las
-- policies, y un valor de enum recién agregado no se puede usar en la misma
-- transacción (55P04, trampa #1 del README).
--
-- QUÉ REEMPLAZA. Relevado en vivo el 18/09/2026: tres pestañas PLANTA 1/2/3
-- (1046/643/993 filas), una fila por día por planta, transcriptas a mano
-- desde tres formularios de papel (control de falta de piedra, parte diario
-- de producción, control de descarga de camiones) que sí tienen turno y
-- operario — dato que se pierde al pasar al Excel. Detalle completo en
-- docs/superpowers/specs/2026-09-18-trituracion-design.md.
--
-- De acá en adelante manda el SdG: la planilla queda de respaldo de una sola
-- dirección (misma decisión que Producción, Despacho, Cantera fase 1 y
-- Taller Vial). El histórico 2026 se importa una sola vez con un script.
--
-- UN PARTE ES POR (planta, fecha), NO POR TURNO. El Excel real nunca tiene
-- dos filas la misma fecha en la misma pestaña — así que `unique(planta_id,
-- fecha)` en vez de modelar turno como una segunda dimensión que hoy no
-- tiene ningún caso real que la justifique.
--
-- TODO LO QUE SE PUEDE DESPEJAR, NO SE GUARDA. Horas teóricas, horas
-- paradas totales, horas reales, disponibilidad, ton/camión y las dos
-- productividades son las mismas columnas que ya trae el Excel, pero son
-- función de lo que sí se guarda (horario, las 4 horas de parada,
-- toneladas, camiones) — lib/trituracion/horas.ts las despeja, igual que
-- Producción con "lo producido".
--
-- OPERARIO Y ORIGEN, SIN FORZAR UN ENLACE. `operario_id` referencia
-- `empleados` (nullable) + `operario_raw` de respaldo, mismo patrón que
-- `equipo_id`/`equipo_raw` de Taller Vial — el histórico importado no tiene
-- operario en absoluto porque el Excel nunca lo tuvo. `origen` es texto sin
-- FK: en los datos reales conviven yacimientos propios (D1/D6/C1/C3),
-- proveedores externos (LOMA NEGRA, PEZZUCCHI), "ACOPIO" y hasta otra planta
-- como origen — lib/trituracion/origen.ts resuelve a un yacimiento de
-- Cantera sólo cuando coincide exacto, igual que Cantera ya hace con sus
-- fleteros sin resolver.
-- ============================================================

-- ── 1. Permisos ──────────────────────────────────────────────
-- Calcados de Cantera (20260910103229) y Taller Vial (20260917094056).

create or replace function public.tiene_acceso_trituracion()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    es_admin_sistema() or exists (
      select 1 from usuario_modulos
      where usuario_id = auth.uid()
        and modulo = 'trituracion'
    ),
    false
  )
$$;

create or replace function public.puede_editar_trituracion()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    es_admin_sistema() or exists (
      select 1 from usuario_modulos
      where usuario_id = auth.uid()
        and modulo = 'trituracion'
        and nivel in ('edicion', 'admin')
    ),
    false
  )
$$;

create or replace function public.es_admin_trituracion()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    es_admin_sistema() or exists (
      select 1 from usuario_modulos
      where usuario_id = auth.uid()
        and modulo = 'trituracion'
        and nivel = 'admin'
    ),
    false
  )
$$;

-- ── 2. Plantas ───────────────────────────────────────────────
-- Catálogo chico (hoy 3 filas), editable sólo por el admin del módulo por si
-- se agrega o se da de baja una planta.

create table if not exists trituracion_plantas (
  id     uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  nombre text not null,
  activa boolean not null default true,
  orden  int not null default 0
);

comment on table trituracion_plantas is
  'Las plantas de trituración (hoy 3). `codigo` es el número que usa la pestaña de Sheets correspondiente ("PLANTA {codigo}"), no un id de visualización.';

alter table trituracion_plantas enable row level security;

drop policy if exists trituracion_plantas_select on trituracion_plantas;
create policy trituracion_plantas_select on trituracion_plantas
  for select to authenticated using (tiene_acceso_trituracion());
drop policy if exists trituracion_plantas_write on trituracion_plantas;
create policy trituracion_plantas_write on trituracion_plantas
  for all to authenticated using (es_admin_trituracion()) with check (es_admin_trituracion());

insert into trituracion_plantas (codigo, nombre, orden)
values ('1', 'Planta 1', 1), ('2', 'Planta 2', 2), ('3', 'Planta 3', 3)
on conflict (codigo) do nothing;

-- ── 3. El parte diario ───────────────────────────────────────

create table if not exists trituracion_partes (
  id                  uuid primary key default gen_random_uuid(),
  planta_id           uuid not null references trituracion_plantas(id),
  fecha               date not null,
  estado              text not null default 'opero' check (estado in ('opero', 'no_opero')),
  motivo_no_operativo text,
  material            text,
  origen              text,
  hora_inicio         time,
  hora_fin            time,
  operario_id         uuid references empleados(id) on delete set null,
  operario_raw        text,
  horas_mantenimiento numeric not null default 0,
  horas_falta_piedra  numeric not null default 0,
  horas_produccion    numeric not null default 0,
  horas_otro          numeric not null default 0,
  motivo_otro         text,
  camiones_llegados   int,
  toneladas_procesadas numeric,
  observaciones       text,
  sheets_pendiente    text,
  sheets_pendiente_en timestamptz,
  cargado_por         uuid references usuarios(id),
  cargado_en          timestamptz not null default now(),
  actualizado_por     uuid references usuarios(id),
  actualizado_en      timestamptz,
  unique (planta_id, fecha)
);

comment on table trituracion_partes is
  'Un registro por planta y día. Horas teóricas/reales, disponibilidad, ton/camión y las dos productividades NO se guardan: se despejan en lib/trituracion/horas.ts a partir de hora_inicio/hora_fin, las 4 horas de parada, toneladas_procesadas y camiones_llegados.';
comment on column trituracion_partes.operario_raw is
  'Respaldo cuando el operario cargado no matchea a nadie de empleados, y valor único posible en los partes importados del histórico (el Excel nunca tuvo operario).';
comment on column trituracion_partes.origen is
  'Texto libre, sin FK: yacimiento propio (D1/D6/C1/C3), proveedor externo (LOMA NEGRA, PEZZUCCHI), ACOPIO, u otra planta. lib/trituracion/origen.ts resuelve a un yacimiento de Cantera sólo si coincide exacto.';

create index if not exists trituracion_partes_planta_fecha_idx on trituracion_partes (planta_id, fecha);

alter table trituracion_partes enable row level security;

drop policy if exists trituracion_partes_select on trituracion_partes;
create policy trituracion_partes_select on trituracion_partes
  for select to authenticated using (tiene_acceso_trituracion());
drop policy if exists trituracion_partes_write on trituracion_partes;
create policy trituracion_partes_write on trituracion_partes
  for all to authenticated using (puede_editar_trituracion()) with check (puede_editar_trituracion());

notify pgrst, 'reload schema';
