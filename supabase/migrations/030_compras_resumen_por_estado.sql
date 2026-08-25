-- ============================================================
-- SdG — Compras: el resumen que alimenta el tablero
--
-- El tablero dejó de ser un kanban y pasó a ser cinco indicadores: cuántos
-- requerimientos hay en cada etapa de la compra y cuánta plata representan.
--
-- Contar en la base y no en la app es lo que destraba la etapa PEDIDO. El
-- tablero anterior traía las filas para contarlas, y con más de mil pedidos
-- cerrados encima tuvo que recortar la columna a los últimos 90 días para no
-- caerse. Una consulta de cinco filas no necesita esa ventana.
--
-- `security_invoker = true` hace que la vista se evalúe con los permisos de
-- quien consulta y no con los del dueño: sin eso, una vista es un agujero por
-- el que se filtra lo que RLS tapa. Hoy la política de lectura de
-- compras_requerimientos es `using (true)` para authenticated y el resultado
-- sería el mismo, pero el día que se restrinja, la vista acompaña sola.
--
-- Sólo entra lo que ya pasó por gerencia: el circuito de compra arranca en la
-- aprobación, y contar lo que todavía no se aprobó mezclaría dos colas
-- distintas. Lo pendiente de aprobación se mira en Aprobaciones.
-- ============================================================

create or replace view compras_resumen_por_estado
with (security_invoker = true) as
select
  estado_compra,
  count(*)::bigint as cantidad,
  -- El envío suma al comprometido: es plata de la misma compra. `coalesce`
  -- porque las dos columnas son opcionales y un NULL anularía el total de la
  -- fila entera.
  coalesce(sum(coalesce(costo_iva, 0) + coalesce(costo_envio, 0)), 0)::numeric(14,2)
    as monto
from compras_requerimientos
where estado_aprobacion = 'APROBADA'
group by estado_compra;

comment on view compras_resumen_por_estado is
  'Cantidad y monto comprometido por etapa de compra, de los requerimientos ya '
  'aprobados por gerencia. Alimenta los indicadores del tablero.';
