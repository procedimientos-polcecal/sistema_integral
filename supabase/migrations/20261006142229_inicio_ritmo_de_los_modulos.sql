-- ============================================================
-- SdG — Inicio: cuánto hace que no se carga cada módulo
--
-- El Inicio mostraba conteos del día, y este sistema no se carga parejo sino a
-- ráfagas: "Órdenes de carga hoy: 0" es el mismo 0 cuando Despacho está sano
-- que cuando nadie carga nada hace cinco semanas. Medido el 06/10/2026, ocho de
-- estas trece fuentes estaban paradas y nada lo decía.
--
-- El umbral no es fijo: se calcula contra la historia de cada fuente, el hueco
-- más largo que tuvo en 180 días más uno. Un umbral fijo de 7 haría sonar a
-- Facturación todos los días —recién arranca y tiene huecos de 24— y un p90
-- dejaría escapar a Despacho. El detalle, con la tabla de validación, está en
-- docs/superpowers/specs/2026-10-06-inicio-indicadores-design.md
--
-- Seis cosas que parecen de más y no lo son:
--
--   1. `fecha <= current_date`. `calculos_diarios` tiene filas hasta el 18/11 y
--      nada impide que otra tabla las tenga. Sin el tope, los días sin cargar
--      salen negativos y el módulo parece recién cargado.
--   2. La lista de módulos va en un `values` a la izquierda de un `left join`.
--      Producción tiene 0 filas: con un `inner join` desaparecería de la vista y
--      la tarjeta diría que está todo bien.
--   3. `security_invoker = true`. Una vista corre por defecto con los permisos
--      de quien la creó y saltearía el RLS de las trece tablas. Con esto, a
--      quien no tiene acceso a un módulo le llegan nulos en esa fila — que es
--      lo correcto, porque la tarjeta tampoco se le muestra.
--   4. La fuente de cada módulo es **lo que carga una persona**, no un
--      derivado. RRHH mira `fichadas` y no `calculos_diarios`: el cálculo sigue
--      escribiendo filas aunque nadie fiche, así que mirándolo a él RRHH
--      parecería al día mientras marca 66 de 68 empleados ausentes por un
--      archivo que dejó de importarse. Es exactamente el error que esta vista
--      tiene que atrapar.
--   5. La última fecha NO sale de la ventana de 180 días. Esa ventana existe
--      sólo para el hueco máximo, que es lo único que tiene sentido que sea
--      móvil. Si `ultima_fecha` también se calculara sobre ella, un módulo
--      parado hace más de medio año quedaría sin filas dentro de la ventana y
--      pasaría a informarse como "nunca se cargó" —Remises, con 70 días hoy,
--      lo haría al día 181—: falso, y encima pierde cuántos días lleva parado.
--      Con la historia entera, `ultima_fecha is null` quiere decir justo eso:
--      que esa fuente no tuvo nunca una fila.
--   6. Dos de las trece fuentes no son `date`, y el `union all` las trata
--      distinto a propósito. Sin ningún cast, el `union all` resuelve toda la
--      columna `fecha` a `timestamptz` —`date` y `timestamptz` se unifican
--      hacia el segundo—, `fecha - lag(fecha)` pasa a ser un `interval` y
--      `max(hueco)::int` falla al aplicar la migración con `42846`. Ése es el
--      motivo del cast, no la prolijidad. Pero los dos tipos no guardan lo
--      mismo, y por eso los husos son distintos:
--        · `compras_requerimientos.fecha` es un DÍA guardado en un
--          `timestamptz`: 2.080 de 2.080 filas están a medianoche UTC exacta
--          (medido el 06/10/2026), porque viene de la planilla. Se recupera
--          con `at time zone 'UTC'`. Con el huso de Argentina esa medianoche
--          caería a las 21:00 del día anterior y las 2.080 fechas se correrían
--          un día — la misma familia del error que ya dio vuelta 885 fechas
--          en Compras. Es lo que hace la `20260903081542` con Inventario.
--        · `facturas_proveedor.created_at` es un INSTANTE real (llegan a media
--          mañana, hora de Argentina). Lo que se quiere saber es en qué día
--          ARGENTINO entró la factura al buzón: una que entra a las 22:00 de
--          acá es la 01:00 UTC del día siguiente, y un `::date` pelado
--          contaría el día que no es. Va `at time zone
--          'America/Argentina/Buenos_Aires'`.
--
-- `atrasado` NO se calcula acá a propósito: la comparación vive en
-- lib/home/ritmo.ts, que es donde se puede testear. La vista entrega los hechos.
--
-- Cantera mira sólo `cantera_pesadas`: es lo único del módulo que se carga a
-- diario —voladuras, bochones y destape se mueven por evento y un hueco de dos
-- semanas ahí es normal—. Si alguna vez se dejaran de cargar las pesadas pero sí
-- el resto, esta señal miente. Queda anotado.
-- ============================================================

create or replace view inicio_ritmo_modulos
with (security_invoker = true) as
with fuentes as (
             select 'rrhh'::text          as modulo, fecha            from fichadas
  union all  select 'remises',                       fecha            from remises_asistencia
  union all  select 'mantenimiento',                 fecha            from ordenes_trabajo
  -- Un día guardado como `timestamptz` a medianoche UTC: va `'UTC'`. Ver la trampa 6.
  union all  select 'compras',                       (fecha at time zone 'UTC')::date from compras_requerimientos
  union all  select 'inventario',                    fecha            from inventario_movimientos
  union all  select 'produccion',                    fecha            from produccion_partes
  union all  select 'despacho',                      fecha            from despacho_ordenes_carga
  -- `fecha` es la del comprobante y puede ser vieja; `created_at` es cuándo
  -- entró al buzón, que es lo que mide si el módulo se usa. Es un instante real:
  -- va con el huso de Argentina. Ver la trampa 6.
  union all  select 'facturacion',                   (created_at at time zone 'America/Argentina/Buenos_Aires')::date from facturas_proveedor
  union all  select 'cantera',                       fecha            from cantera_pesadas
  union all  select 'calidad',                       fecha            from calidad_movimientos
  union all  select 'calidad_envases',               fecha            from calidad_envases_movimientos
  union all  select 'taller_vial',                   fecha            from taller_vial_cargas
  union all  select 'trituracion',                   fecha            from trituracion_partes
),
-- Sólo para el hueco máximo: los últimos 180 días. NO alimenta `ultima`.
dias as (
  select modulo, fecha
    from fuentes
   where fecha is not null
     and fecha <= current_date
     and fecha >= current_date - 180
   group by modulo, fecha
),
huecos as (
  select modulo, fecha - lag(fecha) over (partition by modulo order by fecha) as hueco
    from dias
),
hueco_maximo as (
  select modulo, max(hueco)::int as hueco_max
    from huecos where hueco is not null group by modulo
),
-- Toda la historia, acotada sólo a `<= current_date`: ver la trampa 5.
ultima as (
  select modulo, max(fecha) as ultima_fecha
    from fuentes
   where fecha is not null
     and fecha <= current_date
   group by modulo
)
select m.modulo,
       u.ultima_fecha,
       (current_date - u.ultima_fecha)::int as dias_sin_cargar,
       coalesce(h.hueco_max, 0)             as hueco_max
  from (values ('rrhh'),('remises'),('mantenimiento'),('compras'),('inventario'),
               ('produccion'),('despacho'),('facturacion'),('cantera'),('calidad'),
               ('calidad_envases'),('taller_vial'),('trituracion')) as m(modulo)
  left join ultima        u on u.modulo = m.modulo
  left join hueco_maximo  h on h.modulo = m.modulo;

comment on view inicio_ritmo_modulos is
  'Por fuente: la última fecha cargada, cuántos días hace y el hueco más largo '
  'de los últimos 180 días. El umbral y la decisión de "atrasado" se calculan '
  'en lib/home/ritmo.ts. Alimenta las tarjetas del Inicio y la campana.';

grant select on inicio_ritmo_modulos to authenticated;
