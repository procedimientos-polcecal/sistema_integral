-- ============================================================
-- SdG — Compras: el vínculo con la orden de compra de Odoo
--
-- Etapa 1 del spec de facturación
-- (docs/superpowers/specs/2026-09-04-facturacion-proveedores-odoo-design.md).
--
-- El problema que resuelve, dicho por quien lo tiene: cargar una factura de
-- proveedor es demasiado lento porque hay que tipearla de cero. En Odoo, una
-- factura generada **desde una orden de compra** viene con ítems, cantidades,
-- precios e impuestos ya puestos. Hoy ese camino casi no se usa: Polysan tiene
-- 2.488 facturas de proveedor y 162 órdenes.
--
-- Y el dato que falta para la orden ya existe en el SdG: el requerimiento sabe
-- el proveedor, la cotización elegida, el precio y la cantidad. Muere acá y se
-- vuelve a tipear en Odoo.
--
-- Un requerimiento son **una o dos** órdenes, no una: si lo pagan las dos
-- empresas son dos órdenes al 50%, porque el proveedor factura a cada CUIT por
-- separado. Por eso es tabla y no columna, igual que `proveedores_odoo`.
-- ============================================================

create table if not exists compras_odoo_ordenes (
  requerimiento_id uuid    not null references compras_requerimientos(id) on delete cascade,
  empresa_id       uuid    not null references empresas(id)               on delete restrict,
  odoo_order_id    integer not null,

  -- El "P02416" que ve la gente en Odoo. Se guarda además del id porque es lo
  -- que hay que decirle a contabilidad —"facturá la P02416"—, y pedirlo de nuevo
  -- a Odoo para mostrar un número en pantalla es un viaje de red al vacío.
  odoo_nombre      text,

  -- 100, o 50 cuando el requerimiento lo pagan las dos empresas.
  porcentaje       smallint not null default 100 check (porcentaje between 1 and 100),

  -- El `write_date` de la orden en Odoo la última vez que la leímos: es lo que
  -- permite el pull incremental sin traer las 2.295 cada vez.
  odoo_write_date  timestamptz,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  primary key (requerimiento_id, empresa_id)
);

-- Una orden de Odoo pertenece a un solo requerimiento dentro de su empresa. Sin
-- esto, un reintento que no encuentre el vínculo crea una segunda orden y el
-- proveedor recibe el pedido dos veces.
create unique index if not exists compras_odoo_ordenes_orden_uniq
  on compras_odoo_ordenes (empresa_id, odoo_order_id);

create trigger compras_odoo_ordenes_updated_at
  before update on compras_odoo_ordenes
  for each row execute function set_updated_at();

comment on table compras_odoo_ordenes is
  'Enlace requerimiento del SdG ↔ purchase.order de Odoo, una fila por empresa. Los vals los arma lib/odoo/ordenDeCompra.ts.';

-- ── El pendiente ─────────────────────────────────────────────
--
-- Si la creación de la orden falla, el requerimiento no puede quedar mudo. Es el
-- mismo patrón que `sheets_pendiente`: se guarda **lo que dijo Odoo, sin
-- traducir**, y se le muestra a quien aprobó. Un fallo de escritura no es un
-- `console.warn`: un estado que cambió en el SdG y no llegó al otro lado es una
-- divergencia que no avisa sola.
--
-- El caso más frecuente ya se conoce: el proveedor existe en una empresa y no en
-- la otra. De los proveedores de Odoo, 262 están en Polcecal, 237 en Polysan y
-- sólo 147 en las dos.

alter table compras_requerimientos
  add column if not exists odoo_pendiente text;

comment on column compras_requerimientos.odoo_pendiente is
  'Por qué no se pudo crear la orden en Odoo, con el mensaje real. NULL = nada pendiente.';

-- ── RLS ──────────────────────────────────────────────────────
--
-- Mismo criterio que `proveedores_odoo`: leer con sesión —las pantallas de
-- Compras muestran el número de orden—, escribir sólo admin del núcleo. La
-- sincronización corre con la service role, que no pasa por RLS.

alter table compras_odoo_ordenes enable row level security;

drop policy if exists compras_odoo_ordenes_select on compras_odoo_ordenes;
create policy compras_odoo_ordenes_select on compras_odoo_ordenes
  for select to authenticated using (true);

drop policy if exists compras_odoo_ordenes_write on compras_odoo_ordenes;
create policy compras_odoo_ordenes_write on compras_odoo_ordenes
  for all to authenticated
  using (es_admin())
  with check (es_admin());
