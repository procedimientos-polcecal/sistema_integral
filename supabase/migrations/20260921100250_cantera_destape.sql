-- ============================================================
-- SdG — Cantera: Destape (fase 3 del spec original, 2026-09-10)
--
-- El costo de destapar el frente de una cantera: horas de máquina propia
-- (con su operario) o de un fletero externo con camión, por yacimiento y
-- día. Relevado en vivo contra la planilla real
-- (1SvF0HK3Zu6Mi5Z_tTokJAypWvHHHp9oEomucqJudE3Y, pestañas Registro/Por
-- día/Tarifas/Resumen/Parametros/Capacidades) el 21/09/2026.
--
-- TODO LO QUE SE PUEDE DESPEJAR, NO SE GUARDA — mismo criterio que el
-- resto del sistema. La planilla real cachea "Costo máquina (aux)"/"Costo
-- MO (aux)"/"Costo fletero (aux)" como fórmulas en cada fila; acá esas tres
-- más "Toneladas (estimado)" se calculan al leer
-- (lib/cantera/destape.ts), no se guardan — evita que cambiar una tarifa
-- vieja deje costos guardados que ya no coinciden con la tarifa vigente.
--
-- LA TARIFA DEL FLETERO ES POR TIPO DE CAMIÓN, NO POR FLETERO. Verificado
-- cifra por cifra contra la planilla real: Orsatti "Camión grande" 8 h →
-- $445.084 = 8 × $55.635,50 (la tarifa de "Camión grande" de agosto 2026),
-- el mismo número que Schneider con el mismo camión y las mismas horas.
-- `cantera_tarifas_destape` junta las 3 tarifas de la pestaña "Tarifas" en
-- una tabla con `categoria` (máquina propia por equipo / MO propia / fletero
-- por tipo de camión) en vez de tres tablas — mismo criterio genérico que
-- `cantera_tarifas_acarreo`, con `categoria`+`clave` en vez de un solo
-- `tipo` porque acá hay tres dimensiones distintas conviviendo.
--
-- "Máquina propia" reusa `equipos` (EM2-EM9, ya cargados por Mantenimiento
-- para el costeo de equipos móviles) y "fletero externo" reusa
-- `cantera_fleteros` (los mismos 11 de Acarreo) — no se duplica ningún
-- catálogo. `tipo_camion` NO es un equipo real (es "Camión grande"/"Camión
-- chico", una categoría de tarifa, no una máquina con patente), así que
-- queda como texto controlado por vocabulario en `lib/cantera/destape.ts`,
-- no una fila de `equipos`.
--
-- "Categoría MO propia" (mano de obra) está vacía en la planilla real hoy
-- —ninguna tarifa cargada todavía—, así que su `clave` queda sin definir a
-- propósito: se puede empezar con una tarifa "general" (un valor único) o
-- por operario más adelante sin migrar nada, `clave` es texto libre.
--
-- `cantera_capacidades_fletero` es la pestaña "Capacidades": toneladas por
-- viaje, por fletero Y tipo de camión (no sólo por tipo — Orsatti "Camión
-- grande" da 0 t/viaje y Schneider "Camión grande" da 44, son capacidades
-- reales distintas del mismo tipo de camión).
-- ============================================================

-- ── 1. Capacidades de fletero (toneladas por viaje) ─────────────

create table if not exists cantera_capacidades_fletero (
  id                  uuid primary key default gen_random_uuid(),
  fletero_id          uuid not null references cantera_fleteros(id) on delete cascade,
  tipo_camion         text not null,
  toneladas_por_viaje numeric not null default 0,
  unique (fletero_id, tipo_camion)
);

comment on table cantera_capacidades_fletero is
  'Toneladas por viaje de un fletero con un tipo de camión — pestaña "Capacidades" de la planilla de destape. 0 = capacidad sin relevar, no "no transporta nada" (lib/cantera/destape.ts no inventa el número).';

-- ── 2. Tarifas de destape ────────────────────────────────────────

create table if not exists cantera_tarifas_destape (
  id        uuid primary key default gen_random_uuid(),
  categoria text not null check (categoria in ('maquina_propia', 'mo_propia', 'fletero_externo')),
  -- Código de equipo ("EM3") para maquina_propia; "camion_grande"/
  -- "camion_chico" para fletero_externo; libre para mo_propia (sin definir
  -- todavía en la planilla real).
  clave     text not null,
  desde     date not null,
  hasta     date,
  tarifa    numeric not null,
  unique (categoria, clave, desde)
);

comment on table cantera_tarifas_destape is
  'Las 3 tarifas $/h de la pestaña "Tarifas" de destape, juntas: máquina propia (por equipo), mano de obra propia y fletero externo (por tipo de camión, no por fletero) — verificado que la tarifa del fletero depende del tipo de camión, no de quién lo maneja.';

-- ── 3. El registro: una fila por recurso usado un día ────────────

create table if not exists cantera_destape (
  id                    uuid primary key default gen_random_uuid(),
  fecha                 date not null,
  -- Texto, sin FK: en la planilla real a veces viene vacío (el "Frente /
  -- Sector" tiene el dato en su lugar), mismo criterio que `cantera_pesadas.origen`.
  yacimiento_codigo     text,
  frente                text,
  tipo_recurso          text not null check (tipo_recurso in ('operario_propio', 'fletero_externo')),
  operario_id           uuid references empleados(id) on delete set null,
  fletero_id            uuid references cantera_fleteros(id) on delete set null,
  -- Siempre poblado, tal cual lo dice la planilla ("Jorge Becker", "Orsatti"
  -- sin número): "Orsatti" solo es ambiguo entre Orsatti 1 y 2, así que
  -- `fletero_id` queda null ahí a propósito — enlazar al que se parece es
  -- peor que null, mismo criterio que ya usa Cantera con pesadas.
  recurso_raw           text not null,
  equipo_id             uuid references equipos(id) on delete set null,
  -- "EM3 - Doosan 225 1" (operario propio) o "Camión grande" (fletero): lo
  -- segundo no es un equipo real, por eso no siempre hay `equipo_id`.
  equipo_o_vehiculo_raw text not null,
  -- Sólo con sentido si tipo_recurso = fletero_externo.
  tipo_camion           text,
  horas                 numeric not null,
  viajes                int,
  observaciones         text,
  origen                text not null default 'sdg',
  sheets_pendiente      text,
  sheets_pendiente_en   timestamptz,
  cargado_por           uuid references usuarios(id),
  cargado_en            timestamptz not null default now(),
  actualizado_por       uuid references usuarios(id),
  actualizado_en        timestamptz
);

comment on table cantera_destape is
  'Un recurso (máquina propia + operario, o fletero con camión) usado un día para destapar un frente. Costo máquina/MO/fletero y toneladas estimadas (viajes × capacidad) NO se guardan: se despejan en lib/cantera/destape.ts contra la tarifa/capacidad vigente en `fecha`, para que corregir una tarifa vieja no deje costos guardados que ya no coinciden.';

create index if not exists cantera_destape_fecha_idx on cantera_destape (fecha);
create index if not exists cantera_destape_yacimiento_idx on cantera_destape (yacimiento_codigo);

-- ── Permisos: mismas funciones que el resto de Cantera ───────────

alter table cantera_capacidades_fletero enable row level security;
alter table cantera_tarifas_destape     enable row level security;
alter table cantera_destape             enable row level security;

drop policy if exists cantera_capacidades_fletero_select on cantera_capacidades_fletero;
create policy cantera_capacidades_fletero_select on cantera_capacidades_fletero
  for select to authenticated using (tiene_acceso_cantera());
drop policy if exists cantera_capacidades_fletero_write on cantera_capacidades_fletero;
create policy cantera_capacidades_fletero_write on cantera_capacidades_fletero
  for all to authenticated using (es_admin_cantera()) with check (es_admin_cantera());

drop policy if exists cantera_tarifas_destape_select on cantera_tarifas_destape;
create policy cantera_tarifas_destape_select on cantera_tarifas_destape
  for select to authenticated using (tiene_acceso_cantera());
drop policy if exists cantera_tarifas_destape_write on cantera_tarifas_destape;
create policy cantera_tarifas_destape_write on cantera_tarifas_destape
  for all to authenticated using (es_admin_cantera()) with check (es_admin_cantera());

drop policy if exists cantera_destape_select on cantera_destape;
create policy cantera_destape_select on cantera_destape
  for select to authenticated using (tiene_acceso_cantera());
drop policy if exists cantera_destape_write on cantera_destape;
create policy cantera_destape_write on cantera_destape
  for all to authenticated using (puede_editar_cantera()) with check (puede_editar_cantera());

notify pgrst, 'reload schema';
