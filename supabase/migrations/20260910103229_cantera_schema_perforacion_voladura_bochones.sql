-- ============================================================
-- SdG — Cantera: perforación, voladura, bochones y sus consumos
--
-- Fase 1 del spec
-- (docs/superpowers/specs/2026-09-10-cantera-design.md).
--
-- Requiere que la migración del enum (20260910103228) ya haya corrido y
-- commiteado: acá se nombra 'cantera' en cuatro funciones y en las policies, y
-- un valor de enum recién agregado no se puede usar en la misma transacción
-- (55P04, trampa #1 del README).
--
-- QUÉ REEMPLAZA. Cuatro planillas de Google encadenadas por fórmulas, con
-- pestañas que arma un Apps Script. De acá en adelante **manda el SdG**: la
-- planilla queda como respaldo de una vía y no se carga más desde ahí. Es la
-- misma decisión de Producción y Despacho.
--
-- LO QUE NO SE GUARDA, SE DESPEJA AL LEER (lib/cantera/):
--   monto perforación = pozos * metros_por_pozo * precio_usd_m * tc
--   monto voladura    = Σ(consumo.cantidad * consumo.precio_usd) * tc
--   monto bochón      = metros_perforados * precio_usd_m * tc
--   toneladas estim.  = pozos * metros_por_pozo * densidad * burden * espaciamiento
-- Un valor derivado guardado se desincroniza y nada avisa — misma razón que
-- Producción con la producción y Despacho con los tiempos.
--
-- EL CONTROL CRUZADO CON ODOO ES DE LECTURA. Finanzas vincula cada etapa a un
-- `account.move` de tipo `in_invoice` que ya existe en Odoo (Canobe, Voladuras
-- Olavarría) y el SdG compara el monto calculado contra `amount_untaxed`. No se
-- postea ni se crea nada en Odoo: la contabilidad la escribe Odoo. Por eso
-- `*_odoo_move_id` es un `int` suelto y no un FK — apunta a Odoo, no a una
-- tabla de acá — y la empresa de la factura se guarda como texto y no como FK a
-- `empresas`: un segundo camino de PostgREST a `empresas` rompería los embeds
-- (trampa de `compras_odoo_ordenes`, sección "Cuidados" de ODOO-INTEGRACION.md).
--
-- CUIDADO AL APLICARLA — EMBEDS. `cantera_bochones` referencia a
-- `cantera_yacimientos` directo y `cantera_voladuras` también, así que hay dos
-- caminos de bochones a yacimientos y `.select("*, cantera_yacimientos(...)")`
-- sobre bochones daría PGRST201. Por eso `cantera_bochones.voladura_codigo`
-- **no es un FK** — es texto libre, y además los bochones se cargan antes de
-- que exista la voladura asociada. Los embeds de `lib/cantera/` nombran la FK a
-- mano igual que `lib/facturacion/consultas.ts`.
--
-- SIN ENUMS DEL MÓDULO. Los campos controlados (`material`, `tipo` de consumo,
-- `conciliacion` implícita) son `text` con el vocabulario en `lib/cantera/`.
-- Un valor de enum nuevo obliga a una migración sola (55P04) y estos crecen.
-- ============================================================

-- ── 1. Permisos ──────────────────────────────────────────────
-- Calcadas de las de Despacho (20260908104729) y Facturación (20260910080315).
-- `es_admin_sistema()` y no `es_admin()`: para código nuevo va la que se
-- explica sola (ver 20260910091647). Las tres funciones y `lib/cantera/auth.ts`
-- tienen que decir lo mismo: cuando no coincidieron, en la 029, un
-- admin_sistema veía los botones y RLS le devolvía listas vacías.

create or replace function public.tiene_acceso_cantera()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    es_admin_sistema() or exists (
      select 1 from usuario_modulos
      where usuario_id = auth.uid()
        and modulo = 'cantera'
    ),
    false
  )
$$;

create or replace function public.puede_editar_cantera()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    es_admin_sistema() or exists (
      select 1 from usuario_modulos
      where usuario_id = auth.uid()
        and modulo = 'cantera'
        and nivel in ('edicion', 'admin')
    ),
    false
  )
$$;

create or replace function public.es_admin_cantera()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    es_admin_sistema() or exists (
      select 1 from usuario_modulos
      where usuario_id = auth.uid()
        and modulo = 'cantera'
        and nivel = 'admin'
    ),
    false
  )
$$;

-- Conciliar facturas: estar en `cantera_finanzas`. A propósito NO incluye el
-- nivel del módulo ni admin_sistema — cargar una voladura y conciliar su
-- factura las hacen personas distintas. Mismo criterio que `puede_aprobar_os()`
-- (20260904140041).
create or replace function public.puede_facturar_cantera()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from cantera_finanzas where usuario_id = auth.uid())
$$;

-- ── 2. Catálogos ─────────────────────────────────────────────

create table if not exists cantera_yacimientos (
  id              uuid primary key default gen_random_uuid(),
  -- El que va dentro del código de voladura: 'D1','D6','C1','C3','A'.
  codigo          text not null unique,
  nombre          text not null,
  -- 'Dolomita' | 'Chocolata' | ... — la densidad va con el tipo de piedra.
  material        text not null,
  densidad_t_m3   numeric not null,
  -- Malla de diseño: prellena el registro, que después la puede pisar.
  burden_m        numeric,
  espaciamiento_m numeric,
  activo          boolean not null default true,
  orden           int not null default 0
);

comment on table cantera_yacimientos is
  'Las canteras/frentes (D1, D6, C1, C3, Alcancía) con su malla de diseño y su tipo de piedra. El día que se abra un frente nuevo es una fila.';

create table if not exists cantera_insumos (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  tipo        text not null,   -- 'detonador' | 'otros_insumos' | 'voladura'
  precio_usd  numeric,         -- vigente; el renglón de consumo lo puede pisar
  activo      boolean not null default true,
  orden       int not null default 0
);

comment on table cantera_insumos is
  'Catálogo de insumos de voladura (emulex, anfo, boosters, detonadores, servicio). Colapsa las tres formas en que hoy está escrito cada uno en la planilla.';

-- ── 3. Quién concilia, y quién factura cada etapa ────────────

create table if not exists cantera_finanzas (
  usuario_id uuid primary key references usuarios(id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table cantera_finanzas is
  'Quiénes pueden conciliar una factura de cantera contra la de Odoo. Pertenecer a la lista ES el permiso, igual que os_aprobadores: no depende del nivel en ningún módulo.';

-- Los contratistas de cantera (hoy Canobe y Voladuras Olavarría). SIN rol:
-- confirmado con el usuario que cualquiera de los dos factura cualquier etapa
-- —perforación, voladura o bochones— y a cualquiera de las dos empresas. Se
-- resuelven a partner(s) de Odoo por `proveedores_odoo`, que ya existe. Una
-- sola FK, así que no abre un segundo camino de embed.
create table if not exists cantera_contratistas (
  proveedor_id uuid primary key references proveedores(id) on delete restrict
);

-- Sembrado: Canobe (CUIT 23224987439) y Voladuras Olavarría (30716046482), por
-- `select` desde `proveedores` para que el archivo no se revierta entero si en
-- esta base ese proveedor no existe (trampa "un error revierte todo" del
-- README). Voladuras Olavarría puede no estar todavía en `proveedores`: en ese
-- caso no inserta nada y lo agrega admin desde /cantera/configuracion.
insert into cantera_contratistas (proveedor_id)
select id from proveedores
where regexp_replace(coalesce(cuit, ''), '\D', '', 'g') in ('23224987439', '30716046482')
on conflict (proveedor_id) do nothing;

-- ── 4. Perforación + voladura: un registro, dos facturas ─────
--
-- El `codigo` (V01D625) es una identidad: la misma voladura tiene una etapa de
-- perforación y una de voladura, cada una con su monto y su factura. `anio` y
-- `correlativo` se guardan como columnas —no sólo dentro del string— para
-- calcular el siguiente sin parsear.

create table if not exists cantera_voladuras (
  id                   uuid primary key default gen_random_uuid(),
  codigo               text not null,
  yacimiento_id        uuid not null references cantera_yacimientos(id) on delete restrict,
  anio                 int  not null,
  correlativo          int  not null,

  -- ── etapa perforación ──
  perf_inicio          date,
  perf_fin             date,
  pozos                numeric,
  metros_por_pozo      numeric,
  burden_m             numeric,   -- prellenado del yacimiento, editable
  espaciamiento_m      numeric,
  perf_precio_usd_m    numeric,
  perf_tc_usd          numeric,
  -- conciliación de la factura de perforación (sólo finanzas):
  perf_odoo_move_id    int,
  perf_odoo_move_name  text,      -- 'BILL/2026/08/0204', cacheado
  perf_odoo_empresa    text,      -- 'POLCECAL' | 'POLYSAN' — texto, no FK
  perf_odoo_ref        text,      -- el nro de papel del proveedor
  perf_odoo_importe    numeric,   -- amount_untaxed (neto) cacheado
  perf_odoo_leido_en   timestamptz,
  perf_conforme        boolean,   -- null = sin revisar
  perf_conforme_obs    text,
  perf_conforme_por    uuid references usuarios(id),
  perf_conforme_en     timestamptz,

  -- ── etapa voladura ──
  vol_fecha_carga      date,
  vol_fecha            date,
  vol_pozos            numeric,   -- pozos volados; puede diferir de `pozos`
  vol_metros_por_pozo  numeric,
  vol_burden_m         numeric,
  vol_espaciamiento_m  numeric,
  vol_tc_usd           numeric,
  explosivos_raw       text,      -- VOLADURAS!Explosivos, verbatim (importación)
  toneladas_planilla   numeric,   -- la columna histórica; no se recalcula
  vol_odoo_move_id     int,
  vol_odoo_move_name   text,
  vol_odoo_empresa     text,
  vol_odoo_ref         text,
  vol_odoo_importe     numeric,
  vol_odoo_leido_en    timestamptz,
  vol_conforme         boolean,
  vol_conforme_obs     text,
  vol_conforme_por     uuid references usuarios(id),
  vol_conforme_en      timestamptz,

  observaciones        text,
  origen               text not null default 'sdg',   -- 'sdg' | 'importacion'
  sheets_pendiente     text,
  sheets_pendiente_en  timestamptz,
  cargado_por          uuid references usuarios(id),
  cargado_en           timestamptz not null default now(),
  actualizado_por      uuid references usuarios(id),
  actualizado_en       timestamptz,

  -- Constraints, no índices parciales: son destinos de ON CONFLICT de la
  -- importación inicial (trampa #2 del README, pisada en la 033 y la 046).
  unique (codigo),
  unique (yacimiento_id, anio, correlativo)
);

comment on table cantera_voladuras is
  'Una fila por código de voladura (V01D625). Guarda la etapa de perforación y la de voladura, con dos montos y dos facturas de Odoo por conciliar.';

create index if not exists cantera_voladuras_yac_fecha_idx
  on cantera_voladuras (yacimiento_id, vol_fecha desc);

-- Para el tablero de finanzas: lo que tiene monto y todavía no se revisó.
create index if not exists cantera_voladuras_sin_conciliar_idx
  on cantera_voladuras (yacimiento_id)
  where perf_conforme is null or vol_conforme is null;

create index if not exists cantera_voladuras_pendiente_idx
  on cantera_voladuras (sheets_pendiente_en)
  where sheets_pendiente is not null;

-- No vincular dos registros a la misma factura de Odoo. Únicos comunes: los
-- nulos no chocan entre sí en Postgres.
create unique index if not exists cantera_voladuras_perf_move_uniq
  on cantera_voladuras (perf_odoo_move_id);
create unique index if not exists cantera_voladuras_vol_move_uniq
  on cantera_voladuras (vol_odoo_move_id);

-- ── 5. Bochones: voladura secundaria, evento aparte ─────────

create table if not exists cantera_bochones (
  id                  uuid primary key default gen_random_uuid(),
  codigo              text not null,
  yacimiento_id       uuid not null references cantera_yacimientos(id) on delete restrict,
  anio                int not null,
  correlativo         int not null,
  -- Texto libre, NO FK: los bochones se cargan antes de que exista la voladura,
  -- y un FK acá abriría un segundo camino de embed a cantera_yacimientos.
  voladura_codigo     text,
  inicio              date,
  fin                 date,
  pozos               numeric,
  metros_perforados   numeric,
  precio_usd_m        numeric,
  tc_usd              numeric,
  odoo_move_id        int,
  odoo_move_name      text,
  odoo_empresa        text,
  odoo_ref            text,
  odoo_importe        numeric,
  odoo_leido_en       timestamptz,
  conforme            boolean,
  conforme_obs        text,
  conforme_por        uuid references usuarios(id),
  conforme_en         timestamptz,
  observaciones       text,
  origen              text not null default 'sdg',
  sheets_pendiente    text,
  sheets_pendiente_en timestamptz,
  cargado_por         uuid references usuarios(id),
  cargado_en          timestamptz not null default now(),
  actualizado_por     uuid references usuarios(id),
  actualizado_en      timestamptz,
  unique (codigo),
  unique (yacimiento_id, anio, correlativo)
);

create index if not exists cantera_bochones_yac_fecha_idx
  on cantera_bochones (yacimiento_id, fin desc);
create index if not exists cantera_bochones_sin_conciliar_idx
  on cantera_bochones (yacimiento_id)
  where conforme is null;
create index if not exists cantera_bochones_pendiente_idx
  on cantera_bochones (sheets_pendiente_en)
  where sheets_pendiente is not null;
create unique index if not exists cantera_bochones_move_uniq
  on cantera_bochones (odoo_move_id);

-- ── 6. Consumos: el detalle de insumos de una voladura ──────
--
-- La versión desglosada del texto libre `explosivos_raw`. total_usd / total_ars
-- NO se guardan: son cantidad * precio_usd y * tc.

create table if not exists cantera_consumos (
  id              uuid primary key default gen_random_uuid(),
  voladura_codigo text not null references cantera_voladuras(codigo) on delete cascade,
  insumo_id       uuid references cantera_insumos(id) on delete set null,
  insumo_raw      text,          -- lo que decía CONSUMOS!Insumo; fuente si insumo_id es null
  tipo            text,          -- 'detonador' | 'otros_insumos' | 'voladura'
  cantidad        numeric not null,
  precio_usd      numeric,       -- del catálogo salvo que se lo pise
  orden           int not null default 0
);

create index if not exists cantera_consumos_voladura_idx
  on cantera_consumos (voladura_codigo);

-- ── 7. RLS ───────────────────────────────────────────────────

alter table cantera_yacimientos   enable row level security;
alter table cantera_insumos       enable row level security;
alter table cantera_finanzas      enable row level security;
alter table cantera_contratistas  enable row level security;
alter table cantera_voladuras     enable row level security;
alter table cantera_bochones      enable row level security;
alter table cantera_consumos      enable row level security;

-- Catálogos: los ve quien tiene el módulo; los toca el admin del módulo.
drop policy if exists cantera_yacimientos_select on cantera_yacimientos;
create policy cantera_yacimientos_select on cantera_yacimientos
  for select to authenticated using (tiene_acceso_cantera());
drop policy if exists cantera_yacimientos_write on cantera_yacimientos;
create policy cantera_yacimientos_write on cantera_yacimientos
  for all to authenticated using (es_admin_cantera()) with check (es_admin_cantera());

drop policy if exists cantera_insumos_select on cantera_insumos;
create policy cantera_insumos_select on cantera_insumos
  for select to authenticated using (tiene_acceso_cantera());
drop policy if exists cantera_insumos_write on cantera_insumos;
create policy cantera_insumos_write on cantera_insumos
  for all to authenticated using (es_admin_cantera()) with check (es_admin_cantera());

drop policy if exists cantera_contratistas_select on cantera_contratistas;
create policy cantera_contratistas_select on cantera_contratistas
  for select to authenticated using (tiene_acceso_cantera());
drop policy if exists cantera_contratistas_write on cantera_contratistas;
create policy cantera_contratistas_write on cantera_contratistas
  for all to authenticated using (es_admin_cantera()) with check (es_admin_cantera());

-- La lista de finanzas: la lee cualquier autenticado —la nav pregunta si quien
-- mira es finanzas para decidir qué dibujar—; la administra el admin del módulo.
drop policy if exists cantera_finanzas_select on cantera_finanzas;
create policy cantera_finanzas_select on cantera_finanzas
  for select to authenticated using (true);
drop policy if exists cantera_finanzas_write on cantera_finanzas;
create policy cantera_finanzas_write on cantera_finanzas
  for all to authenticated using (es_admin_cantera()) with check (es_admin_cantera());

-- Voladuras y bochones: los ve quien tiene el módulo. Escribe quien puede
-- editar el módulo O quien puede facturar — la separación de qué columnas toca
-- cada uno la hace la ruta (edición carga metros/pozos/malla;
-- /conciliacion sólo toca los campos odoo_/conforme_). Igual que Facturación,
-- que comprueba en el código además de en RLS porque algunas rutas van con el
-- cliente admin.
drop policy if exists cantera_voladuras_select on cantera_voladuras;
create policy cantera_voladuras_select on cantera_voladuras
  for select to authenticated using (tiene_acceso_cantera());
drop policy if exists cantera_voladuras_write on cantera_voladuras;
create policy cantera_voladuras_write on cantera_voladuras
  for all to authenticated
  using (puede_editar_cantera() or puede_facturar_cantera())
  with check (puede_editar_cantera() or puede_facturar_cantera());

drop policy if exists cantera_bochones_select on cantera_bochones;
create policy cantera_bochones_select on cantera_bochones
  for select to authenticated using (tiene_acceso_cantera());
drop policy if exists cantera_bochones_write on cantera_bochones;
create policy cantera_bochones_write on cantera_bochones
  for all to authenticated
  using (puede_editar_cantera() or puede_facturar_cantera())
  with check (puede_editar_cantera() or puede_facturar_cantera());

drop policy if exists cantera_consumos_select on cantera_consumos;
create policy cantera_consumos_select on cantera_consumos
  for select to authenticated using (tiene_acceso_cantera());
drop policy if exists cantera_consumos_write on cantera_consumos;
create policy cantera_consumos_write on cantera_consumos
  for all to authenticated
  using (puede_editar_cantera()) with check (puede_editar_cantera());

notify pgrst, 'reload schema';
