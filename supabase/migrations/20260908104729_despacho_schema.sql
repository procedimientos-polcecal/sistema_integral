-- ============================================================
-- SdG — Despacho: tablas, permisos y RLS
--
-- Requiere que la migración del enum ya haya corrido y commiteado.
--
-- Reemplaza el talonario en papel ORDEN DE CARGA (formulario 086/2) y la
-- planilla que hoy se tipea a la mañana siguiente con las órdenes del día
-- anterior. Ver docs/superpowers/specs/2026-09-08-despacho-ordenes-de-carga-design.md.
--
-- LOS TIEMPOS Y EL ESTADO NO SE GUARDAN. Se despejan al leer:
--   tiempo de carga      = fin_carga     - inicio_carga
--   tiempo en predio     = salida_predio - entrada_predio
--   estado               = cuál de los cuatro horarios falta
-- Es la misma decisión que Producción tomó con la producción misma, y por el
-- mismo motivo: un valor derivado guardado se desincroniza y nada avisa. En la
-- planilla `Tiempo de Carga` y `Tiempo en Predio` ya son restas de las otras
-- columnas, no datos.
--
-- El Nº de la orden no vive en Odoo y no puede: `stock.picking` tiene 121
-- campos, un solo campo propio agregado con Studio y es un many2one de otra
-- cosa, y la instancia es de un partner que no admite módulos propios. Por eso
-- la orden de carga es una tabla de acá y el Nº preimpreso es su clave natural.
-- ============================================================

-- ── 1. Permisos ──────────────────────────────────────────────
-- Calcadas de las de Producción (20260907154336), que a su vez venían de
-- Inventario (046). Las tres tienen que decir lo mismo que
-- lib/despacho/auth.ts: cuando no coincidieron, en la 029, un admin_sistema
-- veía los botones y RLS le devolvía listas vacías.

create or replace function public.tiene_acceso_despacho()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    es_admin() or exists (
      select 1 from usuario_modulos
      where usuario_id = auth.uid()
        and modulo = 'despacho'
    ),
    false
  )
$$;

create or replace function public.puede_editar_despacho()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    es_admin() or exists (
      select 1 from usuario_modulos
      where usuario_id = auth.uid()
        and modulo = 'despacho'
        and nivel in ('edicion', 'admin')
    ),
    false
  )
$$;

create or replace function public.es_admin_despacho()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    es_admin() or exists (
      select 1 from usuario_modulos
      where usuario_id = auth.uid()
        and modulo = 'despacho'
        and nivel = 'admin'
    ),
    false
  )
$$;

-- ── 2. El mapeo de productos ─────────────────────────────────
--
-- Los tres campos del talonario —material, granulometría y envase— están
-- metidos dentro del nombre del producto de Odoo:
-- "CARBONATO DE CALCIO 0-1 BOLSÓN (NA)", con espacio al final y sufijos
-- (NA)/(EA). Esta tabla los separa, y la carga una persona.
--
-- NO SE PARSEA EL NOMBRE. Una expresión regular sobre esos nombres es la forma
-- segura de que un día "CAL EN TOLVA" entre como envase Bolsa y nadie lo note.
-- Enlazar al que se le parece es peor que dejar en null: el dato aparece en el
-- lugar que no es. Lo que no está mapeado se muestra "sin clasificar".
--
-- Los tres son texto y no enums, a propósito. Un valor de enum nuevo obliga a
-- una migración sola por valor (55P04, trampa #1), y estos valores van a crecer
-- mientras se mapeen los 432 productos: el talonario dice cuatro materiales y
-- lo que realmente sale incluye Chocolata, Pedregullo 6/20 y Minerales
-- Ecológicos, más un envase Tolva que el papel no tiene. La lista vive en
-- lib/despacho/clasificacion.ts, que es donde se puede cambiar sin una
-- migración.
--
-- Tampoco se reusan los enums de Producción: `produccion_familia` es
-- filler/0_2/cal/otros —y 0_2 no es una familia, es un tamaño— y
-- `produccion_envase` es sólo bolsa/bolson. Forzar el mapeo ahí perdería el
-- granel, la tolva y la granulometría entera.

create table if not exists despacho_productos (
  id                     uuid primary key default gen_random_uuid(),

  -- El id de `product.product` de Odoo. Único: un producto se clasifica una vez.
  odoo_product_id        int not null,
  -- La referencia interna ([FAG], [CET], [CC02B]). Cacheada para poder mostrar
  -- y buscar sin ir a Odoo, que tarda.
  odoo_default_code      text,
  odoo_nombre            text not null,

  material               text not null,
  -- Nullable de verdad: hay productos sin granulometría (Chocolata, Pedregullo).
  granulometria          text,
  envase                 text not null,

  -- El puente con el catálogo de fábrica, cuando el producto existe en los dos
  -- lados. Nullable porque el granel quedó afuera de Producción a propósito y
  -- no tiene fila allá. set null: perder el puente es preferible a impedir dar
  -- de baja un producto del catálogo de Producción.
  produccion_producto_id uuid references produccion_productos(id) on delete set null,

  activo                 boolean not null default true,

  cargado_por            uuid references usuarios(id),
  cargado_en             timestamptz not null default now(),
  actualizado_por        uuid references usuarios(id),
  actualizado_en         timestamptz
);

create unique index if not exists despacho_productos_odoo_uniq
  on despacho_productos (odoo_product_id);

-- ── 3. La orden de carga ─────────────────────────────────────

create table if not exists despacho_ordenes_carga (
  id                  uuid primary key default gen_random_uuid(),

  -- El Nº preimpreso del talonario, arriba a la derecha del papel (13801 en el
  -- que se relevó). Confirmado con el usuario: es único y no se repite entre
  -- talonarios, así que es la clave natural. Texto y no int: es un número
  -- impreso, puede llevar ceros a la izquierda o un prefijo el día que cambie
  -- el talonario, y un int los perdería.
  numero              text not null,

  fecha               date not null,

  -- Las dos empresas numeran los remitos distinto (Polcecal 0001-00077045,
  -- Polysan Polys/OUT/05776) y trabajan distinto, así que la orden tiene que
  -- decir de cuál es. restrict: una empresa con órdenes no se borra.
  --
  -- OJO: **hoy es nullable.** Lo relajó `20260909095546`, porque la planilla no
  -- tiene columna de empresa y las 1.702 órdenes del histórico no la saben. Acá
  -- queda `not null` porque es lo que esta migración realmente creó y ya corrió:
  -- corregirla en el lugar dejaría una base nueva distinta de producción.
  empresa_id          uuid not null references empresas(id) on delete restrict,

  -- El remito de Odoo y el pedido del que salió (el `origin`, S08526).
  -- LOS TRES NULLABLES, y es la decisión más importante de esta tabla: Polysan
  -- deja remitos en draft (20 en 90 días) y confirmed (19), así que la pantalla
  -- no puede asumir que el remito está. Cuando no está, la orden se guarda sin
  -- enlace y se ve que le falta. Nunca se engancha "el que se le parece".
  odoo_picking_id     int,
  odoo_picking_name   text,
  odoo_sale_name      text,
  odoo_product_id     int,

  -- Lo que dice el papel. Con remito son el nombre cacheado del cliente y del
  -- producto; sin remito, lo que escribió el encargado. En los dos casos se
  -- guarda: la planilla los necesita y no vale ir a Odoo para exportar una fila.
  cliente_raw         text,
  producto_raw        text,

  -- Cantidad del remito, en la unidad de Odoo (casi siempre toneladas). Se
  -- cachea para poder mostrar la cola sin ir a Odoo. Null cuando no hay remito:
  -- el papel no tiene cantidad.
  cantidad            numeric,
  unidad              text,

  -- Los cuatro del papel. Nullables porque la orden se va completando mientras
  -- el camión está en el predio: los guarda el servidor al apretar el botón, no
  -- se tipean.
  entrada_predio      timestamptz,
  inicio_carga        timestamptz,
  fin_carga           timestamptz,
  salida_predio       timestamptz,

  -- `Notas` en el papel, `Observaciones` en la planilla.
  notas               text,

  -- La firma del supervisor. Se guarda lo que dice el papel y, aparte, el
  -- enlace al empleado sólo cuando se lo reconoce con certeza.
  -- set null y no restrict: la orden es un documento histórico y perder quién
  -- firmó es preferible a impedir dar de baja a un empleado que ya no está.
  supervisor_raw      text,
  supervisor_id       uuid references empleados(id) on delete set null,

  -- Null en las filas que entran por el importador del histórico: nadie las
  -- cargó en el sistema.
  cargado_por         uuid references usuarios(id),
  cargado_en          timestamptz not null default now(),
  actualizado_por     uuid references usuarios(id),
  actualizado_en      timestamptz,

  -- Qué fila de la planilla es esta orden, para reescribirla al corregir.
  sheets_fila         int,
  -- Por qué no se pudo escribir en la planilla, con lo que dijo Google sin
  -- traducir. Null = está escrita.
  sheets_pendiente    text,
  sheets_pendiente_en timestamptz,

  -- Constraint y no índice parcial: es el destino natural de un ON CONFLICT al
  -- importar el histórico, y un índice parcial no sirve para eso — trampa #2
  -- del README, que ya mordió en la 033 y otra vez en la 046.
  unique (numero)
);

create index if not exists despacho_ordenes_fecha_idx
  on despacho_ordenes_carga (fecha desc);

-- La cola del día pregunta por las que todavía no salieron del predio.
create index if not exists despacho_ordenes_abiertas_idx
  on despacho_ordenes_carga (fecha desc)
  where salida_predio is null;

-- Para no dar de alta dos órdenes contra el mismo remito. Único común y no
-- parcial: en Postgres los nulos no chocan entre sí, así que las órdenes sin
-- remito conviven sin problema, y así el índice sí sirve como destino de un
-- ON CONFLICT (trampa #2).
create unique index if not exists despacho_ordenes_picking_uniq
  on despacho_ordenes_carga (odoo_picking_id);

create unique index if not exists despacho_ordenes_sheets_fila_uniq
  on despacho_ordenes_carga (sheets_fila);

create index if not exists despacho_ordenes_pendiente_idx
  on despacho_ordenes_carga (sheets_pendiente_en)
  where sheets_pendiente is not null;

-- ── 4. RLS ───────────────────────────────────────────────────

alter table despacho_productos      enable row level security;
alter table despacho_ordenes_carga  enable row level security;

drop policy if exists despacho_productos_select on despacho_productos;
create policy despacho_productos_select on despacho_productos
  for select to authenticated using (tiene_acceso_despacho());

drop policy if exists despacho_productos_write on despacho_productos;
create policy despacho_productos_write on despacho_productos
  for all to authenticated
  using (es_admin_despacho())
  with check (es_admin_despacho());

drop policy if exists despacho_ordenes_select on despacho_ordenes_carga;
create policy despacho_ordenes_select on despacho_ordenes_carga
  for select to authenticated using (tiene_acceso_despacho());

-- Las órdenes se corrigen, igual que los partes de Producción: el camión ya se
-- fue y alguien se olvidó de marcar un horario. Si la única forma de arreglarlo
-- fuera volver a la planilla, volveríamos al punto de partida. Queda el rastro
-- de quién y cuándo.
drop policy if exists despacho_ordenes_write on despacho_ordenes_carga;
create policy despacho_ordenes_write on despacho_ordenes_carga
  for all to authenticated
  using (puede_editar_despacho())
  with check (puede_editar_despacho());
