-- ============================================================
-- SdG — Módulo Compras: esquema de dominio
-- Portado de la planilla "PEDIDOS DE COMPRA" (ver docs/COMPRAS.md).
--
-- El requerimiento atraviesa dos etapas con dueños distintos, tal como pasa
-- hoy en la planilla, y por eso lleva DOS estados independientes:
--   1) un área pide            -> alta del RI
--   2) gerencia aprueba/deniega -> estado_aprobacion
--   3) Compras cotiza y compra  -> estado_compra
-- ============================================================

create type compras_estado_aprobacion as enum (
  'PENDIENTE', 'EN_REVISION', 'APROBADA', 'DENEGADA'
);

create type compras_estado_compra as enum (
  'SIN_INICIAR', 'PARA_COMPRAR', 'EN_COMPARATIVA', 'PEDIDO', 'RECIBIDO', 'DENEGADO'
);

create type compras_prioridad as enum (
  'URGENTE', '1 SEMANA', '2 SEMANAS', 'NORMAL', 'LEVE'
);

-- ── Áreas solicitantes ───────────────────────────────────────
-- No son los `sectores` del núcleo: aquéllos son lugares físicos por empresa
-- (Planta Filler 2, Calcinación) y éstas son las áreas de la organización que
-- levantan un pedido (Mantenimiento, Almacén, Taller Vial…).
create table compras_areas (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null unique,
  orden      integer not null default 100,
  activo     boolean not null default true,
  created_at timestamptz not null default now()
);

-- ── Requerimientos internos (RI) ─────────────────────────────
create table compras_requerimientos (
  id                 uuid primary key default gen_random_uuid(),
  -- Continúa la numeración de la planilla; es el número que usa la gente.
  nro_ri             integer not null unique,

  -- Alta
  fecha              timestamptz not null default now(),
  area_id            uuid references compras_areas(id) on delete set null,
  descripcion        text not null,
  codigo             text,
  cantidad           numeric,

  -- Dónde se necesita. Se guarda el texto original de la planilla y, cuando se
  -- lo pudo identificar, la referencia real: mismo criterio que
  -- ordenes_trabajo.equipo_raw / equipment_id.
  -- Varias ubicaciones de la planilla son equipos del módulo Mantenimiento
  -- (CAT 950G, Doosan 225 n°1), así que enlazarlas permite ver cuánto se gastó
  -- por máquina.
  ubicacion_raw      text,
  sector_id          uuid references sectores(id) on delete set null,
  equipo_id          uuid references equipos(id) on delete set null,

  fecha_necesidad    date,
  detalle_extra      text,
  imagen_url         text,
  prioridad          compras_prioridad not null default 'NORMAL',

  -- Qué empresa paga. NULL = ambas, igual que sectores.transversal resuelve el
  -- "AMBOS" de Mantenimiento. Es habitual: pasa en más de un tercio de los RI.
  empresa_id         uuid references empresas(id) on delete restrict,

  solicitante_id     uuid references usuarios(id) on delete set null,
  solicitante_nombre text,

  -- Aprobación
  estado_aprobacion  compras_estado_aprobacion not null default 'PENDIENTE',
  aprobador          text,
  aprobado_en        timestamptz,
  motivo_rechazo     text,

  -- Compra
  estado_compra      compras_estado_compra not null default 'SIN_INICIAR',
  comparativa_url    text,
  proveedor_id       uuid references proveedores(id) on delete set null,
  costo_iva          numeric(14,2),
  costo_envio        numeric(14,2),
  moneda             text not null default 'ARS',
  oc_numero          text,
  fecha_pedido       date,
  fecha_recepcion    date,

  -- Origen y sincronización con la planilla
  origen             text not null default 'app',   -- app | import | sheets
  hoja_origen        text,
  sheets_fila        integer,
  sheets_sincronizado_en timestamptz,
  -- Una vez que el RI se gestionó desde el sistema, la planilla ya no lo pisa.
  editado_en_app     boolean not null default false,

  created_by         uuid references usuarios(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index compras_req_area_idx       on compras_requerimientos (area_id);
create index compras_req_aprobacion_idx on compras_requerimientos (estado_aprobacion);
create index compras_req_compra_idx     on compras_requerimientos (estado_compra);
create index compras_req_proveedor_idx  on compras_requerimientos (proveedor_id);
create index compras_req_equipo_idx     on compras_requerimientos (equipo_id);
create index compras_req_empresa_idx    on compras_requerimientos (empresa_id);
create index compras_req_fecha_idx      on compras_requerimientos (fecha desc);
create index compras_req_sheets_idx     on compras_requerimientos (hoja_origen, sheets_fila);

-- Búsqueda por texto sobre descripción, detalle y código.
create index compras_req_busqueda_idx on compras_requerimientos
  using gin (to_tsvector('spanish',
    coalesce(descripcion,'') || ' ' || coalesce(detalle_extra,'') || ' ' || coalesce(codigo,'')));

create trigger compras_requerimientos_updated_at
  before update on compras_requerimientos
  for each row execute function set_updated_at();

-- ── Comparativa de proveedores ───────────────────────────────
-- En la planilla la comparativa era un link a otro documento. Acá queda
-- estructurada, que es lo que permite comparar y auditar por qué se eligió.
create table compras_cotizaciones (
  id               uuid primary key default gen_random_uuid(),
  requerimiento_id uuid not null references compras_requerimientos(id) on delete cascade,
  proveedor_id     uuid not null references proveedores(id) on delete restrict,
  precio_unitario  numeric(14,2),
  precio_total     numeric(14,2),
  costo_envio      numeric(14,2),
  plazo_entrega    text,
  condiciones      text,
  url              text,
  elegida          boolean not null default false,
  created_by       uuid references usuarios(id) on delete set null,
  created_at       timestamptz not null default now(),
  unique (requerimiento_id, proveedor_id)
);

create index compras_cotiz_req_idx on compras_cotizaciones (requerimiento_id);

-- ── Historial ────────────────────────────────────────────────
create table compras_historial (
  id               uuid primary key default gen_random_uuid(),
  requerimiento_id uuid not null references compras_requerimientos(id) on delete cascade,
  campo            text not null,
  valor_anterior   text,
  valor_nuevo      text,
  usuario_id       uuid references usuarios(id) on delete set null,
  usuario_nombre   text,
  nota             text,
  created_at       timestamptz not null default now()
);

create index compras_historial_req_idx on compras_historial (requerimiento_id, created_at desc);

-- ── Registro de sincronizaciones con la planilla ─────────────
create table compras_sincronizaciones (
  id                 uuid primary key default gen_random_uuid(),
  direccion          text not null,                -- importar | exportar
  origen             text not null default 'cron', -- cron | manual | webhook
  filas_leidas       integer not null default 0,
  filas_nuevas       integer not null default 0,
  filas_actualizadas integer not null default 0,
  filas_omitidas     integer not null default 0,
  error              text,
  duracion_ms        integer,
  created_at         timestamptz not null default now()
);

create index compras_sync_fecha_idx on compras_sincronizaciones (created_at desc);

-- ── Triggers de dominio ──────────────────────────────────────

-- Deja asentado cada cambio de estado sin depender de que la ruta se acuerde.
create or replace function public.compras_log_cambio_estado()
returns trigger
language plpgsql
as $$
begin
  if new.estado_aprobacion is distinct from old.estado_aprobacion then
    insert into compras_historial (requerimiento_id, campo, valor_anterior, valor_nuevo)
    values (new.id, 'estado_aprobacion', old.estado_aprobacion::text, new.estado_aprobacion::text);
  end if;
  if new.estado_compra is distinct from old.estado_compra then
    insert into compras_historial (requerimiento_id, campo, valor_anterior, valor_nuevo)
    values (new.id, 'estado_compra', old.estado_compra::text, new.estado_compra::text);
  end if;
  return new;
end;
$$;

create trigger compras_requerimientos_log_estado
  after update on compras_requerimientos
  for each row execute function compras_log_cambio_estado();

-- Marca el RI como gestionado desde el sistema. A partir de acá la
-- sincronización desde la planilla deja de pisarlo. Va en la base y no en el
-- código para que no dependa de que un endpoint se acuerde de marcarlo.
create or replace function public.compras_marcar_editado_en_app()
returns trigger
language plpgsql
as $$
begin
  if new.estado_aprobacion is distinct from old.estado_aprobacion
     or new.estado_compra   is distinct from old.estado_compra
     or new.proveedor_id    is distinct from old.proveedor_id
     or new.costo_iva       is distinct from old.costo_iva
     or new.costo_envio     is distinct from old.costo_envio
     or new.comparativa_url is distinct from old.comparativa_url
  then
    new.editado_en_app = true;
  end if;
  return new;
end;
$$;

create trigger compras_requerimientos_editado_app
  before update on compras_requerimientos
  for each row execute function compras_marcar_editado_en_app();

-- Siguiente N° de RI. Se calcula del lado de la base para que dos altas
-- simultáneas no tomen el mismo número (el unique de nro_ri hace fallar a la
-- segunda y la ruta reintenta).
create or replace function public.compras_siguiente_nro_ri()
returns integer
language sql stable
as $$
  select coalesce(max(nro_ri), 0) + 1 from compras_requerimientos
$$;
