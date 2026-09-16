-- ============================================================
-- SdG — Calidad: el corte de los tipos es el 16/12, no el 15
--
-- Corrige el CHECK `calidad_mov_sin_separar` de 20260916090409. Una migración
-- aplicada no se edita: se corrige con otra.
--
-- POR QUÉ. El corte entre "el libro no distinguía vegetal de residual" y "sí"
-- no es una fecha: es UNA FILA. El saldo por tipo aparece por primera vez en la
-- fila 386 de la planilla —`VEGETAL` 208, `RESIDUAL` 169— y es el saldo
-- **después** de esa entrada, un camión de PURICELLI de 15,26 t.
--
-- El problema es que las filas 385 y 386 son las dos del **15/12/2025**, así
-- que cortar por `fecha < '2025-12-15'` las parte al medio: deja esas dos del
-- lado nuevo, donde el saldo inicial ya las contó, y el mismo camión entra dos
-- veces.
--
-- Con `< '2025-12-16'` las dos quedan del lado viejo —`sin_separar`, sin sumar
-- a ningún saldo— y el saldo inicial de 208/169, que es el del cierre del
-- 15/12, queda como el único aporte de ese día. La historia importada y el
-- saldo de hoy dejan de superponerse.
--
-- Lo encontró correr la importación en seco: el saldo recalculado daba
-- −230,48 t de vegetal contra los 260,34 que muestra la planilla.
--
-- Espejo de `CORTE_DE_LOS_TIPOS` en lib/calidad/movimientos.ts. Si uno cambia,
-- el otro también.
--
-- Es seguro correrla aunque ya haya datos: relaja el CHECK, no lo endurece, así
-- que ninguna fila existente puede violarlo.
-- ============================================================

alter table public.calidad_movimientos
  drop constraint if exists calidad_mov_sin_separar;

alter table public.calidad_movimientos
  add constraint calidad_mov_sin_separar check (
    carbon <> 'sin_separar' or fecha < date '2025-12-16'
  );
