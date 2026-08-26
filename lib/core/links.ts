/**
 * Rescatar el link que una planilla esconde detrás de un texto.
 *
 * En las planillas de la empresa los links casi nunca se ven: la celda dice
 * "LINK" y la URL está en una fórmula `HYPERLINK` o en el hipervínculo de la
 * celda. Guardar lo que se ve sería guardar la palabra "LINK".
 *
 * Es puro y sin dependencias a propósito: lo usan tanto el servidor como las
 * pantallas.
 */

/**
 * La URL de una celda, mire donde mire.
 *
 * Primero la fórmula, después el hipervínculo de la celda, y por último la
 * posibilidad de que alguien haya pegado la URL como texto plano.
 */
export function linkDeCelda(
  formula: string | null | undefined,
  hipervinculo: string | null | undefined
): string | null {
  const f = String(formula ?? "").trim();

  const enFormula = f.match(/^=\s*HYPERLINK\s*\(\s*"([^"]+)"/i);
  if (enFormula) return enFormula[1];

  if (hipervinculo && hipervinculo.trim()) return hipervinculo.trim();

  // Alguien pudo pegar la URL como texto plano.
  if (/^https?:\/\//i.test(f)) return f;

  return null;
}
