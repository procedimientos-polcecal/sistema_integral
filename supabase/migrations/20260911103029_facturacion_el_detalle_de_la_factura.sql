-- ============================================================
-- SdG — Facturación: una línea por producto de la factura
--
-- Hasta acá el borrador que el SdG crea en Odoo tenía **una sola línea por el
-- total**, con la cuenta de gasto que Odoo le pone al proveedor. Eso alcanza
-- para que la factura exista, y no alcanza para la contabilidad: el gasto de una
-- factura con cuatro ítems distintos cae entero en una cuenta.
--
-- Con el detalle cargado, el borrador sale con una línea por producto, cada una
-- con su cuenta y su distribución analítica.
--
-- ## Por qué esto se puede hacer, medido (11/09/2026)
--
-- **El QR no trae el detalle**: trae emisor, número, fecha y total. El detalle
-- sale de leer el **texto** del PDF, y se lo reconoce sin plantilla por
-- proveedor porque una fila de detalle tiene aritmética que cierra —cantidad por
-- precio da el total— y porque la suma de las líneas tiene que dar el neto que
-- el QR ya dijo. Dos controles que fallan por motivos distintos. Si no cuadran,
-- el detalle **no se usa** y la factura sigue yendo con una línea sola.
--
-- Y hace falta: de 11.048 líneas de factura de proveedor de la instancia,
-- **9.659 (87%) llevan distribución analítica**. Es una práctica establecida, no
-- una función de lujo.
--
-- El 66% de las facturas tienen **una sola línea** (mediana 1, p90 3, máximo
-- 14), así que esto no cambia el caso común: lo que arregla es el 34% donde hoy
-- había que desglosar a mano.
--
-- ## Qué se guarda de Odoo, y qué no
--
-- Se guardan los ids **y** el nombre con que se eligieron. El id es lo que viaja
-- a Odoo; el nombre es para poder leer la fila dentro de seis meses sin tener
-- que ir a buscar qué era la cuenta 706 — y para notar si alguien la renombró.
-- Es el mismo criterio que `proveedores_odoo.cuit`.
-- ============================================================

create table if not exists facturas_proveedor_lineas (
  id            uuid primary key default gen_random_uuid(),
  factura_id    uuid not null references facturas_proveedor(id) on delete cascade,

  -- El orden en que salen impresas. Sin esto la factura se lee desordenada y
  -- nadie la puede comparar contra el papel.
  orden         smallint not null default 0,

  -- ── Lo que dice el comprobante ──
  descripcion   text not null,
  cantidad      numeric,
  precio_unitario numeric,
  -- El importe impreso manda sobre cantidad × precio: hay emisores que redondean
  -- la multiplicación (medido: siete centavos en una línea de ALMENTA).
  total         numeric,

  -- ── Lo que se eligió del lado de Odoo ──
  odoo_product_id     integer,
  odoo_product_nombre text,
  odoo_account_id     integer,
  odoo_account_nombre text,

  /*
   * La distribución analítica con la forma que usa Odoo: {"<id>": porcentaje}.
   * Se guarda igual que allá para que no haya traducción en el medio — una
   * conversión es un lugar donde se pierde un centavo de porcentaje sin que nadie
   * lo note. Los porcentajes suman 100.
   */
  analitica         jsonb,
  -- Los nombres de esas cuentas analíticas, para poder leer la fila después.
  analitica_detalle text,

  /*
   * De dónde salió el producto. Mismo criterio que `identificado_por` en la
   * factura: si mañana el gasto quedó en la cuenta equivocada, la primera
   * pregunta es si lo eligió el sistema o una persona.
   */
  producto_origen text
    check (producto_origen is null or producto_origen in ('aprendido', 'sugerido', 'a mano')),

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists facturas_proveedor_lineas_factura_idx
  on facturas_proveedor_lineas (factura_id, orden);

create trigger facturas_proveedor_lineas_updated_at
  before update on facturas_proveedor_lineas
  for each row execute function set_updated_at();

comment on table facturas_proveedor_lineas is
  'El detalle de una factura del buzón, leído del texto del PDF. Una fila por producto; alimenta las líneas del borrador en Odoo.';

-- ── Cómo quedó el detalle, en la factura ─────────────────────
--
-- Va en la factura y no en cada línea porque es una propiedad de la lectura
-- entera: o el detalle cuadra con el neto y se usa, o no y la factura va con una
-- línea sola. Que sea visible evita la pregunta "¿por qué esta salió con una
-- línea y aquélla con cuatro?".

alter table facturas_proveedor
  add column if not exists detalle_leido text
    check (detalle_leido is null or detalle_leido in ('cuadra', 'no cuadra', 'sin detalle'));

comment on column facturas_proveedor.detalle_leido is
  'Si el detalle leído del PDF cuadra con el neto del comprobante. Sólo cuando cuadra el borrador de Odoo sale con una línea por producto.';

-- ── El archivo, del lado de Odoo ─────────────────────────────
--
-- El mismo PDF que el buzón escanea se sube como adjunto del asiento, así que
-- quien revisa el borrador en Odoo tiene el comprobante a mano sin salir de ahí.
-- Se guarda el id para no volver a subirlo en cada reintento: un adjunto
-- duplicado no rompe nada pero ensucia el chatter.

alter table facturas_proveedor
  add column if not exists odoo_attachment_id integer;

comment on column facturas_proveedor.odoo_attachment_id is
  'El ir.attachment del PDF en Odoo. Evita subir el mismo archivo dos veces.';

-- ── RLS: las mismas reglas que la factura ────────────────────

alter table facturas_proveedor_lineas enable row level security;

drop policy if exists facturas_lineas_select on facturas_proveedor_lineas;
create policy facturas_lineas_select on facturas_proveedor_lineas
  for select to authenticated using (tiene_acceso_facturacion());

drop policy if exists facturas_lineas_insert on facturas_proveedor_lineas;
create policy facturas_lineas_insert on facturas_proveedor_lineas
  for insert to authenticated with check (puede_editar_facturacion());

drop policy if exists facturas_lineas_update on facturas_proveedor_lineas;
create policy facturas_lineas_update on facturas_proveedor_lineas
  for update to authenticated
  using (puede_editar_facturacion())
  with check (puede_editar_facturacion());

-- A diferencia de la factura, una línea **sí** se borra: el detalle se relee o
-- se corrige, y una línea que el lector inventó tiene que poder desaparecer.
drop policy if exists facturas_lineas_delete on facturas_proveedor_lineas;
create policy facturas_lineas_delete on facturas_proveedor_lineas
  for delete to authenticated using (puede_editar_facturacion());
