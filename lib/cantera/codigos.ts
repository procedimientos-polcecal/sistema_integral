/**
 * El código de una voladura o un bochón: `V{NN}{yac}{AA}` / `B{NN}{yac}{AA}`.
 *
 * Lo dijo el usuario así: la letra (`V` voladura, `B` bochón), seguida del
 * número de voladura **de ese yacimiento en ese año**, seguido del código corto
 * del yacimiento, seguido de los dos últimos dígitos del año volado.
 *
 *   V01D625  →  1ª voladura de D6 de 2025
 *   V15C326  →  15ª voladura de C3 de 2026
 *   V01A26   →  1ª voladura de Alcancía (código "A") de 2026
 *   B03D126  →  3er bochón de D1 de 2026
 *
 * El código se fija al crear y **no persigue** cambios posteriores de la fecha:
 * una voladura cargada en diciembre y disparada en enero conserva el año viejo,
 * que es lo que ya pasa en la planilla.
 *
 * El correlativo se guarda además como columna (`cantera_voladuras.correlativo`)
 * para calcular el siguiente sin tener que parsear el string.
 */

export type TipoDeCodigo = "V" | "B";

export interface CodigoDesarmado {
  tipo: TipoDeCodigo;
  correlativo: number;
  /** El código corto del yacimiento, tal cual aparece en el string ("D6", "A"). */
  yacimiento: string;
  /** El año completo (2025, 2026), reconstruido de los dos dígitos. */
  anio: number;
}

const RELLENO = 2;

/** Los dos últimos dígitos de un año como string de dos caracteres. */
function dosDigitos(anio: number): string {
  return String(anio % 100).padStart(2, "0");
}

/**
 * De dos dígitos a año completo. Ventana centrada en el presente: `26` es 2026,
 * `98` sería 1998. No hace falta que sea infalible —las canteras arrancaron en
 * 2025— pero evita clavar el "20" y romper en 2100.
 */
function anioCompleto(dd: number, ahora: Date = new Date()): number {
  const siglo = Math.floor(ahora.getFullYear() / 100) * 100;
  const candidato = siglo + dd;
  // Si el candidato queda más de 50 años en el futuro, era del siglo pasado.
  return candidato > ahora.getFullYear() + 50 ? candidato - 100 : candidato;
}

export function armarCodigo(
  tipo: TipoDeCodigo,
  yacimientoCodigo: string,
  correlativo: number,
  anio: number
): string {
  const nn = String(correlativo).padStart(RELLENO, "0");
  return `${tipo}${nn}${yacimientoCodigo}${dosDigitos(anio)}`;
}

/**
 * Desarma un código existente.
 *
 * Necesita la lista de códigos de yacimiento porque el string es ambiguo sin
 * ella: en `V01D625`, `D6` lleva un dígito y no se puede separar el correlativo
 * del yacimiento a ojo. Se prueba cada código conocido como sufijo del tramo
 * del medio.
 *
 * Devuelve `null` si no cierra: código mal formado, o un yacimiento que no está
 * en la lista. No se adivina.
 */
export function parsearCodigo(
  codigo: string,
  yacimientoCodigos: string[],
  ahora: Date = new Date()
): CodigoDesarmado | null {
  const limpio = codigo.trim().toUpperCase();
  const m = limpio.match(/^([VB])(.+?)(\d{2})$/);
  if (!m) return null;

  const tipo = m[1] as TipoDeCodigo;
  const medio = m[2]; // correlativo + código de yacimiento
  const anio = anioCompleto(Number(m[3]), ahora);

  // El código de yacimiento más largo que matchee gana ("C3" antes que "3").
  const candidatos = [...yacimientoCodigos]
    .map((c) => c.toUpperCase())
    .sort((a, b) => b.length - a.length);

  for (const yac of candidatos) {
    if (medio.endsWith(yac)) {
      const corr = medio.slice(0, medio.length - yac.length);
      if (/^\d+$/.test(corr)) {
        return { tipo, correlativo: Number(corr), yacimiento: yac, anio };
      }
    }
  }
  return null;
}

/**
 * El próximo correlativo libre, dado los que ya existen para un
 * `(yacimiento, año)`. Empieza en 1; no rellena huecos (si se borró la 3 de
 * cinco, la próxima es la 6), porque un código es un identificador y reusarlo
 * confunde más de lo que ahorra.
 */
export function proximoCorrelativo(usados: number[]): number {
  return usados.length === 0 ? 1 : Math.max(...usados) + 1;
}

/**
 * Qué año va en el código. El de la fecha de voladura si ya se cargó; si no, el
 * año en curso. Es lo que decide el `AA` del string y la columna `anio`.
 */
export function anioParaCodigo(
  fechaVoladura: string | null | undefined,
  ahora: Date = new Date()
): number {
  if (fechaVoladura && /^\d{4}-\d{2}-\d{2}/.test(fechaVoladura)) {
    return Number(fechaVoladura.slice(0, 4));
  }
  return ahora.getFullYear();
}
