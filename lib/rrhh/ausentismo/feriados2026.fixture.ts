/**
 * Los 17 feriados reales de 2026, tal como están en la tabla `feriados`.
 *
 * Los comparten los tests de `diasHabiles` y de `reportes`: con ellos los
 * hábiles acumulados a junio dan 120 y a octubre 204, y de esos números
 * cuelgan los ejemplos medidos del diseño (141 días sobre 120 = 117,5 %). Una
 * lista inventada da otro denominador sin que nada avise.
 */
export const FERIADOS_2026 = [
  "2026-01-01", "2026-02-16", "2026-02-17", "2026-03-24", "2026-04-02",
  "2026-04-03", "2026-05-01", "2026-05-25", "2026-06-15", "2026-06-20",
  "2026-07-09", "2026-08-17", "2026-10-12", "2026-10-28", "2026-11-20",
  "2026-12-08", "2026-12-25",
];
