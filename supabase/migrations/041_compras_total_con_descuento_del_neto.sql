-- ============================================================
-- SdG — Compras: el descuento sale del neto, no del total con IVA
--
-- El total de un presupuesto se calculaba así:
--
--     unitario * cantidad * (1 - descuento) * (1 + IVA) + envío
--
-- o sea: se descontaba primero y el IVA se aplicaba sobre el neto ya
-- descontado. La forma que usa Compras es otra:
--
--     unitario * cantidad * (1 + IVA) - (unitario * cantidad * descuento) + envío
--
-- El IVA se aplica sobre el neto completo y el descuento se resta después, sin
-- IVA encima. Da distinto: con unitario 290, IVA 21% y 10% de descuento, la
-- vieja daba 315,81 y esta da 321,90.
--
-- Sólo 2 de las 312 cotizaciones cargadas tienen descuento distinto de cero, así
-- que el recálculo mueve dos totales. Con descuento en cero las dos fórmulas son
-- idénticas, que es por qué esto no se notó antes.
--
-- El espejo en TypeScript es `totalCotizacion()` de lib/compras/comparativa.ts,
-- y la fórmula que la app escribe en la planilla de comparativa la arma
-- `filaParaPlanilla()`. Las tres tienen que decir lo mismo: los casos de
-- `comparativa.test.ts` están para que no se pueda mover una sola.
-- ============================================================

alter table compras_cotizaciones drop column if exists precio_total;

alter table compras_cotizaciones
  add column precio_total numeric(14,2)
  generated always as (
    round(
      coalesce(precio_unitario, 0) * coalesce(cantidad, 1) * (1 + coalesce(iva, 0))
      - (coalesce(precio_unitario, 0) * coalesce(cantidad, 1) * coalesce(descuento, 0))
      + coalesce(costo_envio, 0)
    , 2)
  ) stored;
