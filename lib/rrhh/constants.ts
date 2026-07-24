/**
 * Sectores administrativos que trabajan de lunes a viernes (no rotan fines
 * de semana como el resto de la planta): ni sábado ni domingo cuentan como
 * ausencia injustificada si no hay fichada. Es una regla de negocio fija,
 * no configurable desde la app. Matchea por nombre de sector (no por ID) —
 * acoplamiento heredado del original, ver spec de la Fase 2.
 */
export const SECTORES_LUNES_A_VIERNES = [
  "Administración",
  "Calidad",
  "Compras y Pañol",
  "Finanzas",
  "RRHH",
  "Tesorería",
  "Ventas y Despacho",
];
