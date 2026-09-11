-- ============================================================
-- SdG - Despacho: recepcion de carbonilla
--
-- Spec: docs/superpowers/specs/2026-09-11-despacho-recepcion-de-carbonilla-design.md
--
-- POR QUE. Llega un camion de carbonilla, Nico lo pesa cargado (bruto), el
-- camion descarga, lo pesa vacio (tara), y con el neto genera en Odoo una orden
-- de compra sin precio -- el carbonillero no se va sin un papel -- que marca
-- como recibida para poder facturarla despues. Al final transcribe todo a una
-- planilla de Sheets. Tres sistemas para un camion.
--
-- LO QUE SE MIDIO (11/09/2026). La planilla tiene **567 renglones** de un ano
-- (09/09/2025 a 10/09/2026): 231 dias con carga, 2,5 camiones por dia, 11.221
-- toneladas, promedio 19,79 por camion. En Odoo hay **577 ordenes de compra de
-- carbonilla** en el mismo periodo -- una por camion --, `P#####`, estado
-- `purchase`, y **570 de 577 tienen una sola linea**. O sea que la planilla es
-- una transcripcion a mano de algo que ya existe.
--
-- Y `orden 1615` de la planilla **es la `P01615` de Odoo**: de los 118 numeros
-- anotados, 116 existen y 104 tienen la misma fecha. Los otros son ordenes
-- cargadas el lunes siguiente.
--
-- LO QUE HOY SE PIERDE ENTERO ES EL PESAJE. Ni Odoo ni la planilla guardan el
-- bruto y la tara: sobrevive solo el neto. Es lo unico verdaderamente nuevo que
-- guarda esta tabla.
--
-- EL PRECIO NACE SIMBOLICO Y SE CORRIGE AL FACTURAR, y eso se midio: de las
-- ordenes sin facturar, 287 tienen precio <= $2 y 3 tienen precio real; de las
-- facturadas, 190 real y 97 simbolico. Agosto y septiembre de 2026 son 56
-- simbolicas y cero reales. Por eso el SdG pone el simbolico: en la recepcion el
-- precio no esta acordado. Queda anotado que eso perpetua lo que la factura
-- despues reprecia a mano (ver el spec de facturacion, 2026-09-04).
--
-- SIN ENUM PARA EL LUGAR DE DESCARGA. Son dos valores medidos -- ARRIBA (83) y
-- ABAJO (23) -- y van como texto validado en el codigo
-- (`LUGARES_DE_DESCARGA` en lib/despacho/recepcion.ts), por el mismo motivo que
-- las listas de material/granulometria/envase: un valor nuevo de enum obliga a
-- una migracion sola (55P04, la trampa #1 del README, que ya mordio dos veces).
-- La contra, dicha: la base no rechaza un valor inventado, asi que la ruta
-- valida antes de escribir.
-- ============================================================

-- == 1. Que producto y que nombre le corresponde a cada carbonillero ==

-- No se deduce: se carga una vez por proveedor, y lo que falta se ve. Es la
-- misma decision que el mapeo de productos de las ordenes de carga.
create table if not exists despacho_recepcion_proveedores (
  proveedor_id        uuid primary key references proveedores(id) on delete cascade,

  -- Membranex trae `Carbonilla de coque` (58 de sus 64 ordenes); el resto,
  -- `CARBONILLA`. **Se elige por id y nunca por nombre**: en Odoo hay dos
  -- productos que se ven identicos, `CARBONILLA` y `CARBONILLA ` con un espacio
  -- al final, y son 414 y 94 lineas respectivamente.
  odoo_product_id     int not null,
  odoo_product_nombre text not null,

  -- `Bruzzone`, no `BRUZZONE JUAN ALBERTO`. La planilla la siguen leyendo
  -- personas que tienen un ano de historia escrito asi. Hoy hay 51 textos
  -- distintos para diez proveedores; de aca en mas se escribe uno.
  nombre_planilla     text not null,

  activo              boolean not null default true,
  cargado_por         uuid references usuarios(id),
  cargado_en          timestamptz not null default now(),
  actualizado_por     uuid references usuarios(id),
  actualizado_en      timestamptz
);

comment on table despacho_recepcion_proveedores is
  'Que producto de Odoo le corresponde a cada proveedor que trae material, y '
  'como se lo nombra en la planilla. Una fila por proveedor, cargada a mano.';

-- == 2. La recepcion: una fila por camion ====================

create table if not exists despacho_recepciones (
  id                     uuid primary key default gen_random_uuid(),

  fecha                  date not null,
  -- 575 de las 577 ordenes del ano son de Polcecal, pero la empresa se elige y
  -- no se asume: el vinculo del proveedor con Odoo (`proveedores_odoo`) es
  -- **por empresa**, asi que la empresa decide contra que partner se crea.
  empresa_id             uuid references empresas(id),
  proveedor_id           uuid not null references proveedores(id),

  -- Que se recibio. El nombre va cacheado para poder mostrarlo sin ir a Odoo,
  -- igual que en el catalogo de productos.
  odoo_product_id        int,
  odoo_product_nombre    text,

  -- Lo unico nuevo del mundo: hoy el pesaje no esta en ningun lado. En kilos,
  -- que es lo que dice la balanza; la tonelada es una division, no un dato.
  peso_bruto_kg          numeric,
  peso_tara_kg           numeric,

  -- ARRIBA / ABAJO. Ver la cabecera: texto validado en el codigo, no enum.
  lugar_descarga         text,
  notas                  text,

  -- El rastro de los tres pasos en Odoo. Se guardan **apenas ocurren**: si la
  -- validacion del picking falla despues de crear la orden, el reintento valida
  -- lo que falta y no crea una segunda orden. Es la leccion de
  -- `empujarOrdenesDeRequerimiento`, donde mandarle al proveedor el mismo
  -- pedido dos veces era el error mas caro de todos.
  odoo_purchase_order_id int,
  odoo_purchase_name     text,
  odoo_picking_id        int,
  -- Lo que dijo Odoo, sin traducir. Un diagnostico que no se distingue de otro
  -- no es un diagnostico.
  odoo_error             text,
  odoo_error_en          timestamptz,

  -- El espejo de la planilla, igual que las ordenes de carga.
  sheets_fila            integer,
  sheets_pendiente       text,
  sheets_pendiente_en    timestamptz,

  cargado_por            uuid references usuarios(id),
  cargado_en             timestamptz not null default now(),
  actualizado_por        uuid references usuarios(id),
  actualizado_en         timestamptz
);

comment on table despacho_recepciones is
  'Un camion de material recibido: el pesaje (bruto y tara, en kilos), su orden '
  'de compra en Odoo y su fila en la planilla. El neto y el estado no se '
  'guardan: se despejan al leer, como los tiempos de la orden de carga.';

-- Una orden de Odoo pertenece a una sola recepcion. Es el unique que hace
-- idempotente el reintento, y es comun y no parcial a proposito: en Postgres los
-- nulos no chocan entre si -- hay muchas recepciones sin orden todavia -- y un
-- indice parcial no sirve de destino de ON CONFLICT (trampa #2 del README, que
-- ya mordio dos veces).
create unique index if not exists despacho_recepciones_odoo_uniq
  on despacho_recepciones (odoo_purchase_order_id);

-- La pantalla es "las recepciones del dia", y el historico se filtra por fecha.
create index if not exists despacho_recepciones_fecha_idx
  on despacho_recepciones (fecha desc);

-- Lo que le quedo debiendo a la planilla, que es lo que mira el Inicio.
create index if not exists despacho_recepciones_pendiente_idx
  on despacho_recepciones (sheets_pendiente_en)
  where sheets_pendiente is not null;

-- == 3. Permisos =============================================

-- Las mismas tres funciones del modulo, que ya existen (20260908104729):
-- lectura con acceso, escritura con edicion, y la configuracion por proveedor
-- solo para el admin -- elegir el producto de Odoo equivocado manda material a
-- la cuenta que no es.
alter table despacho_recepciones            enable row level security;
alter table despacho_recepcion_proveedores  enable row level security;

drop policy if exists despacho_recepciones_select on despacho_recepciones;
create policy despacho_recepciones_select on despacho_recepciones
  for select to authenticated using (tiene_acceso_despacho());

drop policy if exists despacho_recepciones_write on despacho_recepciones;
create policy despacho_recepciones_write on despacho_recepciones
  for all to authenticated
  using (puede_editar_despacho())
  with check (puede_editar_despacho());

drop policy if exists despacho_recepcion_proveedores_select on despacho_recepcion_proveedores;
create policy despacho_recepcion_proveedores_select on despacho_recepcion_proveedores
  for select to authenticated using (tiene_acceso_despacho());

drop policy if exists despacho_recepcion_proveedores_write on despacho_recepcion_proveedores;
create policy despacho_recepcion_proveedores_write on despacho_recepcion_proveedores
  for all to authenticated
  using (es_admin_despacho())
  with check (es_admin_despacho());

notify pgrst, 'reload schema';
