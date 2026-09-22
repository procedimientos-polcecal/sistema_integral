-- ============================================================
-- SdG — Cantera: "Resumen anual" — pesadas agrupadas por fletero+tipo+mes en SQL
--
-- Mismo problema que Destape (ver `20260922092048_...sql`), en otra
-- pantalla: `ResumenAnualSection.tsx` (el "Resumen anual" de la página
-- principal de Cantera) traía `cantera_pesadas` filtrada por año para
-- agruparla en la app — pero TODAS las 7623 pesadas de la base son del año
-- en curso (verificado en vivo el 22/09/2026: `fecha gte 2026-01-01 lte
-- 2026-12-31` da 7623/7623), así que filtrar por año no achicaba nada: era
-- la tabla entera igual, las mismas 8 páginas paginadas. El comentario que
-- ya tenía el componente ("en producción a veces ni cargaba") lo confirma.
--
-- Se agrupa en la base en vez de traer las filas crudas: una sola consulta
-- devuelve un puñado de filas (fletero × tipo × mes, no fletero × tipo ×
-- pesada) en vez de miles.
--
-- Incluye las filas con `fletero_id` null (no se filtran acá): la pantalla
-- necesita las dos vistas de esto mismo — "por fletero" (que sí excluye las
-- no resueltas, porque ahí el fin es el pago, ver
-- `agruparPesadasPorFleteroTipoMes` en `lib/cantera/pesadas.ts`) y "por
-- tipo de material" (que las incluye, porque el total de la empresa no
-- depende de a quién se le pudo atribuir cada viaje) — separar esas dos
-- reglas es trabajo de la app, no de esta función.
--
-- `date_trunc('month', fecha)` sobre un `date` resuelve a la variante
-- `timestamptz` (STABLE, no IMMUTABLE) si no se castea antes — no importa
-- acá porque esto no es un índice, pero se castea a `fecha::timestamp`
-- de todos modos, por la misma razón que ya documenta el README de
-- migraciones: evita cualquier corrimiento de zona horaria al truncar.
--
-- A propósito NO es `security definer`: corre con el rol de quien llama, la
-- política `cantera_pesadas_select` (`tiene_acceso_cantera()`) se sigue
-- aplicando sola.
-- ============================================================

create or replace function public.cantera_pesadas_por_fletero_tipo_mes(p_anio text)
returns table (fletero_id uuid, tipo text, mes date, toneladas numeric)
language sql
stable
as $$
  select fletero_id, tipo, date_trunc('month', fecha::timestamp)::date as mes, sum(toneladas) as toneladas
  from cantera_pesadas
  where tipo is not null
    and fecha >= (p_anio || '-01-01')::date
    and fecha <= (p_anio || '-12-31')::date
  group by fletero_id, tipo, date_trunc('month', fecha::timestamp);
$$;

comment on function public.cantera_pesadas_por_fletero_tipo_mes(text) is
  'Toneladas de pesadas de un año, sumadas por fletero+tipo+mes (fletero_id puede venir null) — reemplaza traer cantera_pesadas entera a la app para el "Resumen anual" de Cantera (ResumenAnualSection.tsx). Respeta RLS: no es security definer.';

notify pgrst, 'reload schema';
