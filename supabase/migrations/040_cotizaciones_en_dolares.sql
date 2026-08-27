-- ============================================================
-- SdG — Compras: presupuestos en dólares
--
-- Hay proveedores que cotizan en dólares. Hasta ahora eso se resolvía en la
-- planilla: una celda traía el valor del día con =dolarBNA(), cada comparativa
-- lo importaba y las fórmulas convertían. Quien cargaba un presupuesto en el
-- sistema tenía que hacer la cuenta a mano, y ese número quedaba viejo al día
-- siguiente.
--
-- La regla acordada: mientras el presupuesto está en comparativa se muestra al
-- dólar de hoy —así dos presupuestos cargados con semanas de diferencia se
-- comparan con la misma vara—, y al elegirlo se congela la cotización de ese
-- momento, porque lo que se pagó no puede cambiar después.
-- ============================================================

-- ── La cotización, día por día ──────────────────────────────
--
-- Se guarda cada valor que se obtiene, en vez de pedirlo cada vez. Sirve para
-- tres cosas al mismo tiempo: no pegarle a la API en cada carga de pantalla,
-- tener con qué congelar, y seguir funcionando cuando la API no responde. Sin
-- esto, un fin de semana largo con el servicio caído dejaría sin poder cargar
-- un presupuesto en dólares.
create table if not exists cotizaciones_dolar (
  fecha  date primary key,
  -- Los dos valores, aunque hoy sólo se use la venta: si mañana se discute
  -- cuál corresponde, el dato ya está y no hay que reconstruir el histórico.
  compra numeric(14,4),
  venta  numeric(14,4) not null,
  fuente text not null default 'dolarapi',
  created_at timestamptz not null default now()
);

comment on table cotizaciones_dolar is
  'Cotización del dólar oficial por día. La app usa `venta`: es lo que cuesta '
  'conseguir los dólares para pagarle a un proveedor.';

alter table cotizaciones_dolar enable row level security;

-- Leerla puede cualquiera con sesión: es un dato público.
create policy cotizaciones_dolar_select on cotizaciones_dolar
  for select to authenticated using (true);

-- Escribirla, sólo el cliente admin desde la ruta que consulta la API.

-- ── El presupuesto sabe en qué moneda está ──────────────────
alter table compras_cotizaciones
  -- ARS por defecto: los 311 presupuestos que ya están no cambian.
  add column if not exists moneda text not null default 'ARS',
  -- Con qué dólar se congeló. Nula mientras el presupuesto sigue en
  -- comparativa, y ahí se convierte con la cotización del día.
  add column if not exists cotizacion numeric(14,4);

alter table compras_cotizaciones
  drop constraint if exists compras_cotizaciones_moneda_valida;
alter table compras_cotizaciones
  add constraint compras_cotizaciones_moneda_valida check (moneda in ('ARS', 'USD'));

comment on column compras_cotizaciones.moneda is
  'En qué moneda cotizó el proveedor. Vale para el presupuesto entero: si el '
  'precio va en dólares, el envío también.';
comment on column compras_cotizaciones.cotizacion is
  'El dólar con el que se congeló al elegir este presupuesto. Nula mientras '
  'sigue en comparativa. `precio_total` queda siempre en la moneda original: '
  'es una columna generada y no puede depender de un valor que cambia a diario.';
