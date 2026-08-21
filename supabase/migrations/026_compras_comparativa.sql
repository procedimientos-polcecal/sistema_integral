-- ============================================================
-- SdG — Compras: la comparativa de proveedores
--
-- La tabla se estira hasta la forma real de la planilla
-- "00. COMPARATIVA DE PROVEEDORES GENERICO": marca, unidad de medida,
-- cantidad, descuento e IVA por fila, hasta cuándo vale el precio, plazo de
-- pago, disponibilidad y comentario.
--
-- Dos correcciones sobre lo que había:
--
--   * `plazo_entrega` mezclaba dos datos distintos de la planilla: el plazo de
--     PAGO (columna O, en días) y la DISPONIBILIDAD (columna Q, cuándo llega).
--     Se separan.
--   * el `unique (requerimiento_id, proveedor_id)` prohibía que un proveedor
--     cotice dos marcas del mismo artículo, que es un caso real: la planilla
--     tiene columna MARCA.
--
-- Los renames son limpios porque la tabla nunca tuvo pantalla y está vacía
-- (verificado antes de aplicar).
-- ============================================================

alter table compras_cotizaciones
  add column if not exists marca           text,
  add column if not exists unidad_medida   text,
  add column if not exists cantidad        numeric,
  -- Fracciones, como en la planilla: 0.10 es 10%.
  add column if not exists descuento       numeric(6,4) not null default 0,
  -- A diferencia de prioridad y empresa, el IVA sí lleva default: el 21% es la
  -- alícuota general, un hecho y no una decisión disfrazada de dato. Dejarlo
  -- vacío no significa "sin decidir", significa calcular el total mal.
  add column if not exists iva             numeric(6,4) not null default 0.21,
  add column if not exists precio_hasta    date,
  add column if not exists plazo_pago_dias integer,
  add column if not exists disponibilidad  text,
  add column if not exists comentario      text,
  add column if not exists origen          text not null default 'app',
  -- Qué fila ocupa en la planilla de Drive. Es lo que permite volver sobre esa
  -- misma fila —marcarle la elección, vaciarla— sin duplicarla.
  add column if not exists drive_fila      integer;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'compras_cotizaciones'
      and column_name = 'condiciones'
  ) then
    alter table compras_cotizaciones rename column condiciones to condiciones_pago;
  end if;
end $$;

alter table compras_cotizaciones drop column if exists plazo_entrega;

-- ── El total lo calcula la base ──────────────────────────────
-- La fórmula de la plantilla deja el envío afuera, y eso hace que dos
-- presupuestos no sean comparables cuando uno cobra el flete y el otro no.
-- Confirmado con quienes la usan: es un error, no una decisión.
--
-- Va como columna generada para que la cuenta viva en un solo lugar y no pueda
-- quedar desfasada entre la pantalla, la API y el importador. `cantidad` nula
-- vale 1: es una cotización por monto total, no por unidad.
--
-- El espejo en TypeScript es `totalCotizacion()` de lib/compras/comparativa.ts,
-- que existe sólo para mostrar el total mientras alguien escribe el formulario.
-- Si una cambia, la otra tiene que cambiar igual.
alter table compras_cotizaciones drop column if exists precio_total;

alter table compras_cotizaciones
  add column precio_total numeric(14,2)
  generated always as (
    round(
      coalesce(precio_unitario, 0)
        * coalesce(cantidad, 1)
        * (1 - coalesce(descuento, 0))
        * (1 + coalesce(iva, 0))
      + coalesce(costo_envio, 0)
    , 2)
  ) stored;

-- ── Un proveedor puede cotizar dos marcas ────────────────────
do $$
declare nombre text;
begin
  select con.conname into nombre
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where rel.relname = 'compras_cotizaciones'
    and nsp.nspname = 'public'
    and con.contype = 'u';

  if nombre is not null then
    execute format('alter table compras_cotizaciones drop constraint %I', nombre);
  end if;
end $$;

-- ── Qué planilla se adjuntó ──────────────────────────────────
alter table compras_requerimientos
  add column if not exists comparativa_drive_id text,
  add column if not exists comparativa_nombre   text;

comment on column compras_requerimientos.comparativa_drive_id is
  'Archivo de la carpeta de comparativas de Drive del que se cargan los presupuestos.';

comment on column compras_cotizaciones.origen is
  'app = cargada en el sistema; drive = leída de la planilla. Al volver a traer se borran las de drive y se dejan las de app.';
