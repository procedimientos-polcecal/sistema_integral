-- ============================================================
-- SdG — Cantera destape: promedio de toneladas por fletero, calculado en SQL
--
-- `toneladasPromedioPorFletero` (lib/cantera/destape.ts) promedia las
-- pesadas de balanza de TODA la historia de ese fletero, a propósito (ver
-- el comentario de esa función). Hasta hoy, Destape traía
-- `cantera_pesadas` ENTERA a la app (7623 filas al 22/09/2026, y creciendo)
-- para promediarla ahí — 8 pedidos paginados a Supabase, medidos en 2-3.7s,
-- en TODA visita a Destape sin importar el mes.
--
-- Se probó primero paralelizar esos 8 pedidos (commit 0389952, revertido en
-- 68fad67): más rápido en un pedido aislado, pero el usuario reportó la
-- página caída en producción poco después de desplegarlo — la hipótesis que
-- quedó sin descartar (no hubo forma de ver los logs reales de Vercel) es
-- que 8 pedidos simultáneos por visita, con varios usuarios a la vez,
-- agotaban el pool de conexiones de Supabase. Details en la memoria de la
-- sesión.
--
-- Esta vez el arreglo es sacar el promedio de la app: `avg(toneladas)
-- group by fletero_id` en SQL es UN pedido, no ocho, y Postgres nunca tiene
-- que mandar por la red las 7623 filas crudas — sólo el puñado de
-- promedios, uno por fletero. Es estrictamente menos tráfico que la versión
-- paralela, no sólo más rápido.
--
-- A propósito NO es `security definer`: corre con el rol de quien llama, así
-- que la política `cantera_pesadas_select` (`tiene_acceso_cantera()`) se
-- sigue aplicando sola — no hace falta repetir el chequeo de acceso adentro
-- de la función.
-- ============================================================

create or replace function public.cantera_promedio_toneladas_por_fletero()
returns table (fletero_id uuid, promedio numeric, cantidad bigint)
language sql
stable
as $$
  select fletero_id, avg(toneladas) as promedio, count(*) as cantidad
  from cantera_pesadas
  where fletero_id is not null
  group by fletero_id;
$$;

comment on function public.cantera_promedio_toneladas_por_fletero() is
  'Toneladas promedio por viaje, por fletero, sobre TODA su historia de pesadas — reemplaza traer cantera_pesadas entera a la app sólo para promediarla (lib/cantera/destape.ts, toneladasPromedioPorFletero). Respeta RLS: no es security definer.';

notify pgrst, 'reload schema';
