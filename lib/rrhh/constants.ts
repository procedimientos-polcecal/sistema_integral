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
  // Al unificar el padrón en el núcleo, algunos sectores quedaron con el
  // sufijo "(RRHH)" para no chocar con los homónimos de Mantenimiento. Como
  // la regla matchea por nombre exacto, el sector renombrado dejaba de
  // aplicarla: a los 2 empleados de Calidad los sábados les figuraban como
  // falta, cosa que en APPRRHH no pasa. Van los dos nombres.
  //
  // La 20260904112044 le sacó el sufijo —ya no hay homónimos de los que
  // distinguirse—, así que hoy los 2 empleados entran por "Calidad" y este
  // nombre no existe en la base. Se deja igual: sacarlo no gana nada y, si la
  // migración todavía no corrió donde se lea esto, es lo único que sostiene
  // la regla.
  "Calidad (RRHH)",
  "Compras y Pañol",
  "Finanzas",
  "RRHH",
  "Tesorería",
  "Ventas y Despacho",
];
