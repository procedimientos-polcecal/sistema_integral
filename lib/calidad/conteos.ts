/**
 * El conteo físico y el ajuste que propone.
 *
 * En veinte meses hubo **34 conteos** con desvíos de −247 a +148 toneladas, y
 * el saldo teórico seguía de largo: el ajuste se cargaba después, a mano y
 * disfrazado de consumo. Acá el conteo propone el ajuste por la diferencia
 * exacta y **alguien lo confirma escribiendo el motivo** — la confirmación es
 * de la ruta, no de esta función.
 */

function aTresDecimales(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export interface DesvioDelConteo {
  /** Contado menos teórico. Negativo es que falta carbón. */
  desvio: number;
  hayDesvio: boolean;
  /** El ajuste que llevaría el saldo a lo contado, o `null` si no hace falta. */
  ajuste: { toneladas: number } | null;
  problema?: string;
}

export function desvioDelConteo(contado: number, teorico: number): DesvioDelConteo {
  const vacio = { desvio: 0, hayDesvio: false, ajuste: null };

  if (!Number.isFinite(contado) || !Number.isFinite(teorico)) {
    return { ...vacio, problema: "El conteo y el teórico tienen que ser números." };
  }
  if (contado < 0) {
    return { ...vacio, problema: "Un conteo físico no puede ser negativo." };
  }

  const desvio = aTresDecimales(contado - teorico);
  return desvio === 0
    ? { desvio: 0, hayDesvio: false, ajuste: null }
    : { desvio, hayDesvio: true, ajuste: { toneladas: desvio } };
}
