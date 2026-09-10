/**
 * Las toneladas estimadas de una voladura.
 *
 * La fórmula la dio cantera:
 *
 *   toneladas = pozos × metros_por_pozo × densidad × burden × espaciamiento
 *
 * con la densidad del yacimiento (va con el tipo de piedra: Dolomita ≠ Chocolata)
 * y el burden/espaciamiento del registro (que se prellenan con la malla de
 * diseño pero pueden pisarse).
 *
 * Es función pura de la fila, así que se despeja al leer y no se guarda —igual
 * que la producción en Producción y los tiempos en Despacho—.
 *
 * OJO: esta fórmula **no reproduce la columna histórica** de la planilla
 * (V01D625: 36 × 3 × 2,65 × 2,8 × 2,5 = 2.003, pero la planilla dice 1.686,96).
 * Por eso el histórico importado de 2026 se guarda aparte en
 * `toneladas_planilla` y no se recalcula; de la fecha de arranque en adelante,
 * manda este número. Si cantera confirma que falta un factor (altura de banco,
 * pasador), se agrega acá y nada más.
 */

export interface EntradaToneladas {
  /** Metros perforados totales (Σ pozos·metros). Lo calcula el llamador. */
  metros: number | null | undefined;
  densidad: number | null | undefined;
  burden: number | null | undefined;
  espaciamiento: number | null | undefined;
}

function num(v: unknown): number | null {
  return typeof v === "number" && isFinite(v) ? v : null;
}

/**
 * `null` si falta cualquiera de los cuatro datos: una estimación a medias
 * engaña. Como los pozos no tienen todos la misma profundidad, la cuenta va
 * sobre los metros perforados totales y no sobre `pozos × metros_por_pozo`.
 */
export function toneladasEstimadas(e: EntradaToneladas): number | null {
  const m = num(e.metros);
  const d = num(e.densidad);
  const b = num(e.burden);
  const s = num(e.espaciamiento);
  if (m === null || d === null || b === null || s === null) return null;
  return m * d * b * s;
}

export interface Desvio {
  /** estimada − planilla */
  diferencia: number;
  /** (estimada − planilla) / planilla, en tanto por uno. `null` si no se puede comparar. */
  porcentaje: number | null;
  /** El aviso amarillo del tablero: el desvío pasa el umbral. */
  fueraDeRango: boolean;
}

const UMBRAL = 0.15;

/**
 * Compara la estimada contra lo que traía la planilla. Es información, no
 * bloqueo: si difieren mucho, alguien mira; el número que manda sigue siendo la
 * estimada.
 */
export function desvioContraPlanilla(
  estimada: number | null,
  planilla: number | null | undefined
): Desvio {
  const pl = num(planilla);
  if (estimada === null || pl === null || pl === 0) {
    return { diferencia: 0, porcentaje: null, fueraDeRango: false };
  }
  const diferencia = estimada - pl;
  const porcentaje = diferencia / pl;
  return { diferencia, porcentaje, fueraDeRango: Math.abs(porcentaje) > UMBRAL };
}
