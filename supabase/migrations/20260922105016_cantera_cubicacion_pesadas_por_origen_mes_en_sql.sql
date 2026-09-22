-- ============================================================
-- SdG — Cantera: Cubicación — pesadas agrupadas por origen+mes en SQL
--
-- Mismo problema que Destape y el Resumen anual (ver
-- `20260922092048_...sql` y `20260922093520_...sql`): `/cantera/cubicacion`
-- traía `cantera_pesadas` ENTERA (`traerPesadas(supabase, {})`, sin
-- filtro — 7623+ filas, 8 páginas) sólo para sumarla por yacimiento+mes en
-- la app (`toneladasPorYacimientoDesdePesadas`, lib/cantera/pesadas.ts).
-- El usuario reportó no poder entrar a la página ("no me deja entrar").
--
-- A diferencia de Destape (que sólo necesitaba el año en curso), acá hace
-- falta la historia COMPLETA a propósito: `armarCierresCubicacion` encadena
-- la existencia inicial de cada mes con la final del mes anterior, así que
-- no se puede acotar por año sin romper la cadena de meses viejos.
--
-- Se agrupa en la base por origen+mes — de las 7623+ filas quedan unas
-- pocas decenas (4 yacimientos × los meses con datos). `upper(trim(origen))`
-- porque la función de la app ya normaliza así antes de filtrar a los 4
-- códigos de yacimiento (D1/D6/C1/C3) — si acá no se normalizara igual,
-- una variante con espacios o minúsculas quedaría en un grupo aparte y el
-- total de ese mes daría de menos, sin ningún error.
--
-- A propósito NO es `security definer`: corre con el rol de quien llama, la
-- política `cantera_pesadas_select` (`tiene_acceso_cantera()`) se sigue
-- aplicando sola.
-- ============================================================

create or replace function public.cantera_pesadas_por_origen_mes()
returns table (origen text, mes date, toneladas numeric)
language sql
stable
as $$
  select upper(trim(origen)) as origen, date_trunc('month', fecha::timestamp)::date as mes, sum(toneladas) as toneladas
  from cantera_pesadas
  where origen is not null and upper(trim(origen)) in ('D1', 'D6', 'C1', 'C3')
  group by upper(trim(origen)), date_trunc('month', fecha::timestamp);
$$;

comment on function public.cantera_pesadas_por_origen_mes() is
  'Toneladas de pesadas de TODA la historia, sumadas por yacimiento (D1/D6/C1/C3) + mes — reemplaza traer cantera_pesadas entera a la app para Cubicación (toneladasPorYacimientoDesdePesadas en lib/cantera/pesadas.ts). Respeta RLS: no es security definer.';

notify pgrst, 'reload schema';
