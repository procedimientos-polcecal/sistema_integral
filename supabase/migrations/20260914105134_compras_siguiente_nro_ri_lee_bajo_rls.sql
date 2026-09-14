-- ============================================================
-- SdG — compras_siguiente_nro_ri() leía bajo RLS y devolvía un número usado
--
-- QUÉ PASA HOY. La función (017) es `language sql stable` y **no** es
-- `security definer`, así que lee `compras_requerimientos` con los permisos de
-- quien la llama. Como la tabla tiene RLS, el `max(nro_ri)` que ve depende de
-- lo que ese usuario pueda ver, no de lo que hay. Medido el 14/09/2026
-- llamándola por PostgREST con la anon key: devuelve **1**, con 1.965
-- requerimientos en la tabla y el último en 1.966.
--
-- POR QUÉ IMPORTA, SI NO LA LLAMA NADIE. Hoy el alta numera por su cuenta en
-- `app/api/compras/requerimientos/route.ts`, con el cliente admin —que saltea
-- RLS— y reintentando ante el 23505 del unique. O sea que el número sale bien
-- y esta función quedó sin usar. Pero **sigue expuesta como `/rest/v1/rpc/`**
-- y su nombre es exactamente el que alguien va a buscar la próxima vez que
-- necesite numerar un RI. Un helper que se llama "siguiente nro ri" y devuelve
-- uno ya usado no falla: escribe un duplicado.
--
-- Y el duplicado no es hipotético en este módulo. El 09/09/2026 dos RI 1954
-- convivieron unas horas —por otra causa, una fórmula de la planilla— y el
-- `upsert` por `nro_ri` de la sincronización colapsó los dos en uno: el pedido
-- que había entrado por el formulario desapareció del sistema. Está contado en
-- docs/COMPRAS-ESTADO.md.
--
-- QUÉ CAMBIA. Pasa a `security definer` con `search_path` fijo, igual que
-- `es_admin()` (002) y las demás funciones de permiso del núcleo: lee la tabla
-- entera y devuelve el máximo de verdad. Sigue siendo `stable` y de sólo
-- lectura — no escribe, no decide permisos y no expone ninguna fila: devuelve
-- un entero.
--
-- POR QUÉ NO SE BORRA. Porque no se puede probar que nada la llame desde
-- afuera del repo: adentro no la usa nadie (medido, incluidos los Apps Script
-- de la planilla), pero un `drop` rompería en silencio a cualquier cosa que la
-- esté usando. Dejarla correcta cuesta lo mismo y no rompe nada.
--
-- OJO AL USARLA. `max + 1` sigue teniendo la carrera de siempre entre dos altas
-- simultáneas; de eso se ocupa el unique de `nro_ri` y el reintento de la ruta.
-- Esta migración arregla que el número sea el correcto, no que sea atómico.
-- ============================================================

create or replace function public.compras_siguiente_nro_ri()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(max(nro_ri), 0) + 1 from compras_requerimientos
$$;

comment on function public.compras_siguiente_nro_ri() is
  'Siguiente N° de RI libre. Es security definer desde el 14/09/2026: sin eso '
  'leía compras_requerimientos bajo RLS y devolvía 1 para quien no viera la '
  'tabla entera, o sea un número ya usado. No la llama nadie en el repo — el '
  'alta numera con el cliente admin y reintenta ante el unique—, pero queda '
  'correcta porque está expuesta por PostgREST. Sigue sin ser atómica: contra '
  'dos altas simultáneas protege el unique de nro_ri, no esta función.';

notify pgrst, 'reload schema';
