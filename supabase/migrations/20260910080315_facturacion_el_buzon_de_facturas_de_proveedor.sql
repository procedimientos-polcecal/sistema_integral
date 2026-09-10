-- ============================================================
-- SdG — Facturación: el buzón de facturas de proveedor
--
-- Etapa 2 del spec
-- (docs/superpowers/specs/2026-09-04-facturacion-proveedores-odoo-design.md).
--
-- El problema, dicho por quien lo tiene: cargar una factura cuesta demasiado
-- tiempo, y hay que tipearla desde el PDF o el papel. Entran unas **19 por
-- día** —96 en los cinco días entre el 03 y el 08/09—, por mail, en papel y por
-- WhatsApp, las tres.
--
-- El buzón es la puerta única: entra el archivo, el sistema lee el QR y de ahí
-- salen el emisor, el número, la fecha y el importe **sin tipear nada**. Toda
-- factura electrónica argentina lo lleva, así que no hace falta OCR.
--
-- ## Lo que este buzón NO hace
--
-- No postea nada en Odoo y no reemplaza la carga contable. Registra lo que
-- llegó, con su respaldo, y lo vincula al requerimiento cuando corresponde. La
-- factura la sigue cargando administración: el SdG propone, Odoo confirma.
--
-- ## Cuidado al aplicarla: rompe embeds
--
-- `facturas_proveedor` tiene FK a **empresas**, **proveedores** y
-- **compras_requerimientos** a la vez, así que abre segundos caminos de embed y
-- todo `.select("*, proveedores(nombre)")` sobre `compras_requerimientos`
-- empezaría a fallar con `PGRST201`. Ya pasó con `compras_odoo_ordenes` y dejó
-- el listado de Compras sin cargar.
--
-- Las ocho consultas afectadas **ya se desambiguaron** a
-- `proveedores!proveedor_id(nombre)` en el commit que trae esta migración. Si
-- aparece un PGRST201 después de aplicarla, es una consulta nueva: se arregla
-- nombrando la FK, no sacando la tabla.
-- ============================================================

-- ── 1. El CUIT de las empresas del grupo ─────────────────────
--
-- El QR trae el CUIT del receptor, o sea que dice **a cuál de las dos empresas
-- se le facturó**. Sin esto habría que elegirlo a mano en cada factura. Se
-- llena con el `vat` de `res.company` de Odoo.

alter table empresas
  add column if not exists cuit text;

comment on column empresas.cuit is
  'CUIT de la empresa, once dígitos sin guiones. Sirve para reconocer al receptor en el QR de una factura.';

-- ── 2. Permisos del módulo ───────────────────────────────────
-- Calcadas de las de Inventario y Compras: mismos tres niveles.

create or replace function public.tiene_acceso_facturacion()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    es_admin() or exists (
      select 1 from usuario_modulos
      where usuario_id = auth.uid()
        and modulo = 'facturacion'
    ),
    false
  )
$$;

-- ¿Puede cargar facturas al buzón y vincularlas?
create or replace function public.puede_editar_facturacion()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    es_admin() or exists (
      select 1 from usuario_modulos
      where usuario_id = auth.uid()
        and modulo = 'facturacion'
        and nivel in ('edicion', 'admin')
    ),
    false
  )
$$;

-- ── 3. El buzón ──────────────────────────────────────────────

create table if not exists facturas_proveedor (
  id            uuid primary key default gen_random_uuid(),

  -- ── La identidad fiscal del comprobante ──
  --
  -- Estos cuatro campos son la clave natural. Van sin `not null` porque una
  -- factura en papel mal escaneada entra igual: el buzón nunca se bloquea.
  cuit_emisor       text,
  tipo_comprobante  smallint,
  punto_venta       integer,
  numero            integer,

  fecha             date,
  importe_total     numeric,
  moneda            text not null default 'ARS',
  cae               text,

  -- ── Con qué se relaciona ──
  empresa_id        uuid references empresas(id) on delete restrict,
  proveedor_id      uuid references proveedores(id) on delete restrict,
  requerimiento_id  uuid references compras_requerimientos(id) on delete set null,

  -- ── El respaldo ──
  archivo_url       text,
  archivo_nombre    text,

  /*
   * Por dónde entró. No es estadística: si mañana el 80% entra por WhatsApp,
   * automatizar el mail no sirve de nada.
   */
  origen            text not null default 'carga manual'
                    check (origen in ('mail', 'papel', 'whatsapp', 'carga manual')),

  /*
   * Un dato leído del comprobante o uno tipeado por una persona.
   *
   * No es metadato de adorno: si mañana un importe no cuadra, la primera
   * pregunta es cuál de las dos cosas fue, y sin esta columna los dos casos son
   * indistinguibles.
   */
  identificado_por  text not null default 'a mano'
                    check (identificado_por in ('qr', 'a mano')),

  estado            text not null default 'recibida'
                    check (estado in ('recibida', 'vinculada', 'informada', 'contabilizada')),

  /** La factura en Odoo, cuando aparezca. */
  odoo_move_id      integer,

  notas             text,
  cargado_por       uuid references usuarios(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

/*
 * La misma factura entra dos veces, y es cuestión de tiempo.
 *
 * Llega por mail y en papel, o dos personas la cargan el mismo día. La identidad
 * de un comprobante son sus cuatro datos fiscales, así que el índice los usa y
 * el segundo intento encuentra la que ya estaba en vez de duplicarla.
 *
 * Índice único **común, no parcial**: un parcial no sirve como destino de
 * `ON CONFLICT` y rompe el upsert (trampa nº2 del README, pisada dos veces). En
 * Postgres los nulos no chocan entre sí, así que las facturas sin QR —que no
 * tienen estos datos— no se estorban.
 */
create unique index if not exists facturas_proveedor_identidad_uniq
  on facturas_proveedor (cuit_emisor, tipo_comprobante, punto_venta, numero);

create index if not exists facturas_proveedor_requerimiento_idx
  on facturas_proveedor (requerimiento_id);

create index if not exists facturas_proveedor_estado_idx
  on facturas_proveedor (estado);

create trigger facturas_proveedor_updated_at
  before update on facturas_proveedor
  for each row execute function set_updated_at();

comment on table facturas_proveedor is
  'El buzón: una fila por factura de proveedor recibida, entre por donde entre. No reemplaza la carga contable en Odoo.';

-- ── 4. RLS ───────────────────────────────────────────────────
--
-- Leer con acceso al módulo; cargar y vincular, con nivel de edición. Borrar no
-- se contempla: una factura que llegó, llegó. Si se cargó mal se corrige, y si
-- no era del grupo se anota en `notas`.

alter table facturas_proveedor enable row level security;

drop policy if exists facturas_proveedor_select on facturas_proveedor;
create policy facturas_proveedor_select on facturas_proveedor
  for select to authenticated using (tiene_acceso_facturacion());

drop policy if exists facturas_proveedor_insert on facturas_proveedor;
create policy facturas_proveedor_insert on facturas_proveedor
  for insert to authenticated with check (puede_editar_facturacion());

drop policy if exists facturas_proveedor_update on facturas_proveedor;
create policy facturas_proveedor_update on facturas_proveedor
  for update to authenticated
  using (puede_editar_facturacion())
  with check (puede_editar_facturacion());

-- ── 5. Storage: los archivos ─────────────────────────────────
--
-- Mismo criterio que las fotos de Mantenimiento: bucket privado, acotado a
-- quien tenga el módulo. 20 MB porque un PDF escaneado de varias páginas pesa
-- bastante más que una foto, y rechazar una factura por tamaño sería devolverle
-- el problema a quien la está cargando.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'facturas-proveedor',
  'facturas-proveedor',
  false,
  20971520,
  array['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic']
)
on conflict (id) do nothing;

drop policy if exists facturas_archivos_insert on storage.objects;
create policy facturas_archivos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'facturas-proveedor' and puede_editar_facturacion());

drop policy if exists facturas_archivos_select on storage.objects;
create policy facturas_archivos_select on storage.objects for select to authenticated
  using (bucket_id = 'facturas-proveedor' and tiene_acceso_facturacion());
