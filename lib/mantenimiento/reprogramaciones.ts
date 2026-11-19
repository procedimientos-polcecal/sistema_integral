/**
 * Las reprogramaciones de una OT: la cadena de fechas que se ve en una fila
 * del listado y cuántos días se corrió la orden en total.
 *
 * Son funciones puras sobre las filas de `mant_reprogramaciones_ot`. Los
 * movimientos llegan YA ORDENADOS por `creado_en` ascendente y acá no se
 * reordenan: ordenar de nuevo escondería un error de quien consulta.
 *
 * La cadena termina en la fecha VIGENTE de la OT y no en el `fecha_nueva` del
 * último movimiento. Entre el movimiento y la lectura puede haber entrado una
 * sincronización de la planilla que la volvió a mover, y lo que la fila tiene
 * que mostrar es dónde está la orden ahora.
 */

export interface Reprogramacion {
  id: string;
  ot_id: string;
  fecha_anterior: string | null;
  fecha_nueva: string;
  /** 'sistema' si una persona usó Postergar; 'planilla' si lo notó la sincronización. */
  origen: "sistema" | "planilla";
  razon: string | null;
  razon_etiqueta: string | null;
  justificacion: string | null;
  creado_por: string | null;
  creado_en: string;
}

/** Días enteros de `desde` a `hasta`, con fechas "YYYY-MM-DD" (UTC: sin deriva por huso). */
function diasEntre(desde: string, hasta: string): number {
  const [a1, m1, d1] = desde.split("-").map(Number);
  const [a2, m2, d2] = hasta.split("-").map(Number);
  return Math.round(
    (Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / 86_400_000,
  );
}

/**
 * Las fechas en orden, de la original a la vigente. No repite dos seguidas;
 * una fecha a la que se vuelve después de pasar por otra sí figura de nuevo.
 */
export function cadenaDeFechas(
  movimientos: readonly Reprogramacion[],
  fechaVigente: string | null,
): string[] {
  const cadena: string[] = [];
  const agregar = (f: string | null) => {
    if (f && cadena[cadena.length - 1] !== f) cadena.push(f);
  };
  if (movimientos.length > 0) agregar(movimientos[0].fecha_anterior);
  for (const m of movimientos) agregar(m.fecha_nueva);
  agregar(fechaVigente);
  return cadena;
}

/**
 * Días entre la primera fecha de la cadena y la vigente. Negativo si la orden
 * terminó adelantada; 0 si nunca se movió.
 */
export function diasCorridos(
  movimientos: readonly Reprogramacion[],
  fechaVigente: string | null,
): number {
  const cadena = cadenaDeFechas(movimientos, fechaVigente);
  if (cadena.length < 2) return 0;
  return diasEntre(cadena[0], cadena[cadena.length - 1]);
}

/** Días que movió este movimiento; null si la OT no tenía fecha antes. */
export function diasDelMovimiento(m: Reprogramacion): number | null {
  if (!m.fecha_anterior) return null;
  return diasEntre(m.fecha_anterior, m.fecha_nueva);
}
