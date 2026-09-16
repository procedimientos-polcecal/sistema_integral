-- ============================================================
-- SdG — Calidad: tablas, permisos y RLS
--
-- REQUIERE QUE 20260916090407_calidad_enum_del_modulo.sql YA HAYA CORRIDO Y
-- ESTÉ CONFIRMADO. Las policies de abajo mencionan 'calidad', y un valor de
-- enum recién agregado no se puede usar en la misma transacción (55P04).
--
-- Reemplaza la planilla de stock de carbonilla (1m9DwAcP…), donde hoy Calidad
-- transcribe a mano lo que Despacho ya transcribió a la planilla de recepción y
-- que ya estaba en Odoo. Dos transcripciones para el mismo camión, y la segunda
-- es la que manda el stock de la fábrica.
--
-- EL SIGNO VA GUARDADO, NO DESPEJADO. `toneladas` es siempre el efecto sobre el
-- saldo: entrada +, consumo −, ajuste ±. Con eso el saldo es SUM(toneladas) y
-- no hay consulta que pueda calcularlo mal. Los CHECK de abajo son el espejo
-- exacto de `efectoEnElSaldo()` en lib/calidad/movimientos.ts: si uno cambia,
-- el otro también.
--
-- LOS SALDOS NO SE GUARDAN: se despejan al leer. En la planilla vieja eran
-- fórmulas por fila que alguien ya pisó a mano al menos una vez (02/05/2026,
-- +232,5 t), y ése es exactamente el modo de fallar de un derivado guardado.
--
-- Diseño: docs/superpowers/specs/2026-09-16-calidad-stock-de-carbonilla-design.md
-- ============================================================

-- ── 1. Los tipos ─────────────────────────────────────────────
-- Van en este archivo y no aparte: 55P04 es sólo para AGREGAR un valor a un
-- enum que ya existe. Estos se crean enteros.

create type calidad_movimiento_tipo as enum ('entrada', 'consumo', 'ajuste');

-- 'sin_separar' es HISTORIA, NO SALDO. El libro viejo no distinguía vegetal de
-- residual hasta el 15/12/2025, y marcar esos once meses como vegetal sería
-- inventar: en esa época Membranex entró más de veinte veces con carbón
-- residual y hubo 82 consumos residuales desde el 13/10. Como no es ninguno de
-- los dos tipos, no cae en ninguna suma de saldo — no porque alguien se acuerde
-- de excluirlo, sino por construcción.
create type calidad_tipo_carbon as enum ('vegetal', 'residual', 'sin_separar');

create type calidad_origen as enum ('odoo', 'recepcion', 'manual', 'importacion');

-- ── 2. Permisos ──────────────────────────────────────────────
-- Calcadas de las de Despacho (20260908104729). Tienen que decir lo mismo que
-- lib/calidad/auth.ts: cuando no coincidieron, en la 029, un admin_sistema veía
-- los botones y RLS le devolvía listas vacías.

create or replace function public.tiene_acceso_calidad()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    es_admin() or exists (
      select 1 from usuario_modulos
      where usuario_id = auth.uid() and modulo = 'calidad'
    ),
    false
  )
$$;

create or replace function public.puede_editar_calidad()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    es_admin() or exists (
      select 1 from usuario_modulos
      where usuario_id = auth.uid() and modulo = 'calidad'
        and nivel in ('edicion', 'admin')
    ),
    false
  )
$$;

create or replace function public.es_admin_calidad()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    es_admin() or exists (
      select 1 from usuario_modulos
      where usuario_id = auth.uid() and modulo = 'calidad' and nivel = 'admin'
    ),
    false
  )
$$;

-- ── 3. Los carbonilleros ─────────────────────────────────────
-- SE IDENTIFICAN POR EL PARTNER DE ODOO, y el proveedor del núcleo es opcional.
--
-- No es rehacer el catálogo del núcleo desde un módulo: acá no hay razón social
-- ni CUIT ni domicilio, hay tipo de carbón y nombre de planilla, que son
-- configuración de Calidad. Se identifica por lo que el dato realmente trae: la
-- línea de compra llega con un partner_id.
--
-- Exigir que exista primero en `proveedores` con CUIT vinculado pondría entre el
-- camión y el stock una tarea que hace un mes no se hace: al 16/09/2026, seis de
-- los diez carbonilleros no tienen CUIT cargado, y LA INVENCIBLE —cinco camiones
-- en septiembre— no existe en el catálogo. Eso ya tiene parado al módulo de
-- recepción de Despacho.

create table public.calidad_carbonilleros (
  id                  uuid primary key default gen_random_uuid(),
  odoo_partner_id     integer not null,
  empresa_id          uuid not null references empresas(id) on delete restrict,
  proveedor_id        uuid references proveedores(id),
  carbon              calidad_tipo_carbon not null,
  nombre_planilla     text not null,
  codigo_planilla     text not null,
  activo              boolean not null default true,
  cargado_por         uuid references usuarios(id),
  cargado_en          timestamptz not null default now(),
  actualizado_por     uuid references usuarios(id),
  actualizado_en      timestamptz,

  -- El vínculo con Odoo es POR EMPRESA, como en proveedores_odoo.
  constraint calidad_carbonilleros_unico unique (odoo_partner_id, empresa_id),
  -- Un carbonillero de hoy nunca puede ser 'sin_separar': ese valor es de la
  -- historia importada y de nada más.
  constraint calidad_carbonilleros_carbon_real check (carbon <> 'sin_separar')
);

-- ── 4. La lista blanca de productos ──────────────────────────
-- SE ELIGE POR ID Y NUNCA POR NOMBRE: en esta base conviven `CARBONILLA`
-- (6909) y `CARBONILLA ` (4419) con un espacio al final, los dos buenos, con
-- 947 líneas entre ambos. Al lado hay `Flete carbonilla`, `Flete de Carbonilla`,
-- `Carbonilla (Archivado)`, `Carbonillia` y `97000kl de carbonilla`.
--
-- `cuenta = false` no es lo mismo que no estar: es "ya lo miré, es flete, no me
-- lo muestres más en la bandeja".

create table public.calidad_productos_odoo (
  odoo_product_id     integer primary key,
  odoo_product_nombre text not null,
  cuenta              boolean not null,
  cargado_por         uuid references usuarios(id),
  cargado_en          timestamptz not null default now()
);

-- ── 5. El libro ──────────────────────────────────────────────

create table public.calidad_movimientos (
  id                      uuid primary key default gen_random_uuid(),
  fecha                   date not null,
  tipo                    calidad_movimiento_tipo not null,
  carbon                  calidad_tipo_carbon not null,
  -- CON SIGNO: es el efecto sobre el saldo, no una magnitud.
  toneladas               numeric(12,3) not null,
  motivo                  text,
  carbonillero_id         uuid references public.calidad_carbonilleros(id),
  proveedor_id            uuid references proveedores(id),
  origen                  calidad_origen not null,
  odoo_purchase_line_id   integer,
  odoo_purchase_name      text,
  despacho_recepcion_id   uuid references public.despacho_recepciones(id),
  sheets_fila             integer,
  sheets_pendiente        text,
  sheets_pendiente_en     timestamptz,
  cargado_por             uuid references usuarios(id),
  cargado_en              timestamptz not null default now(),
  actualizado_por         uuid references usuarios(id),
  actualizado_en          timestamptz,

  constraint calidad_mov_signo check (
    (tipo = 'entrada' and toneladas > 0) or
    (tipo = 'consumo' and toneladas < 0) or
    (tipo = 'ajuste'  and toneladas <> 0)
  ),
  -- El ajuste SIEMPRE lleva motivo escrito, y los otros dos nunca. Hoy el ajuste
  -- se disfraza de consumo y la explicación va en la columna del conteo físico:
  -- el 20/04/2026 hay un "CONSUMO VEGETAL 46" que en realidad decía "AJUSTE DE
  -- STOCK (-46 Tn.)". Un CHECK, no una costumbre.
  constraint calidad_mov_motivo check (
    (tipo =  'ajuste' and motivo is not null and btrim(motivo) <> '') or
    (tipo <> 'ajuste' and motivo is null)
  ),
  constraint calidad_mov_carbonillero check (
    (tipo =  'entrada' and carbonillero_id is not null) or
    (tipo <> 'entrada' and carbonillero_id is null)
  ),
  -- La contención de 'sin_separar': no puede filtrarse a datos nuevos.
  constraint calidad_mov_sin_separar check (
    carbon <> 'sin_separar' or fecha < date '2025-12-15'
  )
);

-- ÍNDICE UNIQUE COMPLETO, NO PARCIAL: es el destino de un ON CONFLICT, y un
-- índice parcial ahí no sirve (trampa del README de migraciones). Los NULL de
-- los consumos y los ajustes no chocan entre sí, así que no hace falta el WHERE.
--
-- Y la clave es LA LÍNEA, no la orden: 7 de las 577 órdenes de carbonilla del
-- año tienen dos líneas —la segunda es FLETE—, así que la orden no identifica un
-- camión y la línea sí.
--
-- Esto es todo el mecanismo anti-duplicado entre la recepción de Despacho y la
-- sincronización con Odoo: las dos guardan el mismo id de línea, y la segunda
-- rebota. No hay cruce por fecha, proveedor y cantidad — que es justo el cruce
-- que en la planilla vieja se corrió un camión tres días seguidos en noviembre.
create unique index calidad_mov_odoo_line on public.calidad_movimientos (odoo_purchase_line_id);
create unique index calidad_mov_recepcion on public.calidad_movimientos (despacho_recepcion_id);
create index calidad_mov_fecha on public.calidad_movimientos (fecha);
create index calidad_mov_carbon_fecha on public.calidad_movimientos (carbon, fecha);

-- ── 6. Los conteos físicos ───────────────────────────────────
-- `teorico_al_contar` SE GUARDA A PROPÓSITO, y no contradice la regla de no
-- guardar derivados: no es el saldo de hoy, es el que el sistema decía ESE DÍA.
-- Si después se corrige un movimiento viejo —y se van a corregir— el teórico de
-- entonces cambia, y el desvío que una persona miró y explicó dejaría de poder
-- reconstruirse. En veinte meses hubo 34 conteos con desvíos de −247 a +148 t.

create table public.calidad_conteos (
  id                  uuid primary key default gen_random_uuid(),
  fecha               date not null,
  carbon              calidad_tipo_carbon not null,
  toneladas_contadas  numeric(12,3) not null,
  teorico_al_contar   numeric(12,3) not null,
  ajuste_id           uuid references public.calidad_movimientos(id),
  notas               text,
  cargado_por         uuid references usuarios(id),
  cargado_en          timestamptz not null default now(),

  constraint calidad_conteos_carbon_real check (carbon <> 'sin_separar')
);

create index calidad_conteos_fecha on public.calidad_conteos (fecha);

-- ── 7. La bandeja ────────────────────────────────────────────
-- Lo que la sincronización no pudo convertir en movimiento, con el motivo
-- escrito. Son unas cuatro por año, pero es una tabla y no un cálculo al vuelo
-- para que la pantalla no dependa de que Odoo conteste.

create table public.calidad_odoo_sin_reconocer (
  odoo_purchase_line_id integer primary key,
  odoo_purchase_name    text not null,
  odoo_partner_id       integer not null,
  odoo_partner_nombre   text not null,
  odoo_product_id       integer not null,
  odoo_product_nombre   text not null,
  fecha                 date not null,
  toneladas             numeric(12,3) not null,
  motivo                text not null,
  visto_en              timestamptz not null default now()
);

-- ── 8. RLS ───────────────────────────────────────────────────

alter table public.calidad_carbonilleros       enable row level security;
alter table public.calidad_productos_odoo      enable row level security;
alter table public.calidad_movimientos         enable row level security;
alter table public.calidad_conteos             enable row level security;
alter table public.calidad_odoo_sin_reconocer  enable row level security;

create policy calidad_carbonilleros_leer on public.calidad_carbonilleros
  for select using (tiene_acceso_calidad());
create policy calidad_carbonilleros_escribir on public.calidad_carbonilleros
  for all using (es_admin_calidad()) with check (es_admin_calidad());

create policy calidad_productos_leer on public.calidad_productos_odoo
  for select using (tiene_acceso_calidad());
create policy calidad_productos_escribir on public.calidad_productos_odoo
  for all using (es_admin_calidad()) with check (es_admin_calidad());

create policy calidad_mov_leer on public.calidad_movimientos
  for select using (tiene_acceso_calidad());
create policy calidad_mov_escribir on public.calidad_movimientos
  for all using (puede_editar_calidad()) with check (puede_editar_calidad());

create policy calidad_conteos_leer on public.calidad_conteos
  for select using (tiene_acceso_calidad());
create policy calidad_conteos_escribir on public.calidad_conteos
  for all using (puede_editar_calidad()) with check (puede_editar_calidad());

create policy calidad_bandeja_leer on public.calidad_odoo_sin_reconocer
  for select using (tiene_acceso_calidad());
create policy calidad_bandeja_escribir on public.calidad_odoo_sin_reconocer
  for all using (puede_editar_calidad()) with check (puede_editar_calidad());
