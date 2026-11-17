-- ============================================================
-- SdG — Cantera: la cubicación de C1 y C3 se cierra JUNTA, con la existencia
-- final cargada por MATERIAL
--
-- EL PROBLEMA (06/11/2026). La cubicación cerraba un número por yacimiento.
-- Pero C1 y C3 dan chocolata Y caliza, y lo que se mide a fin de mes en los
-- galpones llega por material (Chocolata, Caliza), no por yacimiento: la
-- chocolata de C1 y la de C3 están MEZCLADAS en los galpones y nadie puede
-- separarlas. Medido: desde julio salieron 3.637 t de caliza, todas de C3, y
-- no había dónde cargar cuánta caliza quedaba.
--
-- LO QUE NO SE PUEDE SABER, y por eso no se pide: cuánta de la piedra que se
-- vuela es chocolata y cuánta caliza. Al volar nadie lo sabe; se sabe recién
-- cuando el camión pasa por la balanza (el `tipo` de la pesada). Una primera
-- versión pedía un "% de caliza" en cada voladura y se descartó por eso.
--
-- LA DECISIÓN. Desde octubre/2026 C1 y C3 se cierran JUNTAS:
--
--   · el balance es el de siempre y usa totales —voladuras de C1+C3 y acarreo
--     de C1+C3, sin dividir por material—, que es lo que sí se sabe;
--   · la existencia final se carga por material (chocolata y caliza), y su
--     suma es la que entra al balance;
--   · el reparto entre chocolata y caliza sale AL FINAL, medido: lo que se
--     acarreó de cada una más lo que cambió su existencia dice cuánta de cada
--     piedra salió de la cantera ese mes.
--
-- D1 y D6 no cambian. Se pierde el residuo individual de C1 y de C3, que de
-- todos modos no se podía calcular: la existencia medida no se puede repartir.
--
-- QUÉ AGREGA:
--
--  1. `cantera_cubicaciones_material`: la existencia final por mes y material
--     (canteras + acopio por triturar, igual que `cantera_cubicaciones`). Una
--     tabla aparte y no una columna en la vieja: la vieja es por yacimiento y
--     tiene `unique (yacimiento_id, mes)`. Los cierres de C1/C3 hasta
--     septiembre se quedan donde están, como histórico.
--
--  2. `cantera_pesadas_por_origen_tipo_mes()`: como
--     `cantera_pesadas_por_origen_mes()` pero también por `tipo`, para saber
--     cuánta caliza y cuánta chocolata acarrearon C1+C3. NO se edita la vieja
--     (una migración aplicada no se edita): sigue sirviendo a D1 y D6. El
--     `tipo` no dice el yacimiento (hay `chocolata_1` con origen C3): se
--     agrupa por origen Y por tipo.
--
-- SE PUEDE CORRER DE NUEVO: todo lleva `if not exists` / `or replace` / `drop
-- policy if exists`.
-- ============================================================

-- 1. La existencia final por material --------------------------------------

create table if not exists cantera_cubicaciones_material (
  id                uuid primary key default gen_random_uuid(),
  -- Siempre el día 1: es un cierre mensual, no una fecha de evento.
  mes               date not null,
  material          text not null check (material in ('Chocolata', 'Caliza')),
  -- Lo medido en las canteras C1+C3 (en el yacimiento).
  existencia_final  numeric not null,
  -- Lo medido en galpones y acopios por triturar. Null: no se midió — cuenta
  -- como 0 en la suma, pero se muestra como "sin cargar" y no como un cero.
  existencia_acopio numeric,
  observaciones     text,
  cargado_por       uuid references usuarios(id),
  cargado_en        timestamptz not null default now(),
  actualizado_por   uuid references usuarios(id),
  actualizado_en    timestamptz,
  -- Un material, un mes: cargar de nuevo corrige, no duplica. Es una
  -- constraint común (no un índice parcial) para que sirva de destino de
  -- `ON CONFLICT` en el upsert.
  unique (mes, material)
);

comment on table cantera_cubicaciones_material is
  'Existencia final de C1+C3 por mes y material (Chocolata / Caliza), desde 10/2026: la chocolata y la caliza de las dos canteras están mezcladas en los galpones y el balance se cierra con la suma. Voladuras, acarreo, existencia inicial y lectura se calculan al leer (lib/cantera/cubicacionPorMaterial.ts).';

create index if not exists cantera_cubicaciones_material_mes_idx on cantera_cubicaciones_material (mes);

alter table cantera_cubicaciones_material enable row level security;

-- La llamada a la función va envuelta en un select: sin eso Postgres la
-- evalúa por cada fila (ver el README, "Una policy nueva…").
drop policy if exists cantera_cubicaciones_material_select on cantera_cubicaciones_material;
create policy cantera_cubicaciones_material_select on cantera_cubicaciones_material
  for select to authenticated using ((select tiene_acceso_cantera()));
drop policy if exists cantera_cubicaciones_material_write on cantera_cubicaciones_material;
create policy cantera_cubicaciones_material_write on cantera_cubicaciones_material
  for all to authenticated
  using ((select puede_editar_cantera()))
  with check ((select puede_editar_cantera()));

-- 2. Pesadas por origen, tipo y mes ----------------------------------------

-- `fecha::timestamp` y no `fecha`: sobre un `date`, date_trunc resuelve a la
-- variante timestamptz, que es STABLE (trampa 42P17 si alguna vez va a un
-- índice).
create or replace function public.cantera_pesadas_por_origen_tipo_mes()
returns table (origen text, tipo text, mes date, toneladas numeric)
language sql
stable
as $$
  select upper(trim(origen)) as origen, tipo, date_trunc('month', fecha::timestamp)::date as mes, sum(toneladas) as toneladas
  from cantera_pesadas
  where origen is not null and upper(trim(origen)) in ('C1', 'C3')
  group by upper(trim(origen)), tipo, date_trunc('month', fecha::timestamp);
$$;

comment on function public.cantera_pesadas_por_origen_tipo_mes() is
  'Toneladas de pesadas con origen C1 o C3, sumadas por origen + tipo + mes — para repartir el acarreo entre Chocolata y Caliza en la cubicación de C1+C3. No es security definer: respeta RLS.';

notify pgrst, 'reload schema';
