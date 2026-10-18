/**
 * Dónde se dibuja el globo de un `InfoTip`.
 *
 * Vive acá y no adentro del componente para poder probarlo: es la cuenta que
 * decide si el texto se lee entero o sale cortado, y eso no se nota al
 * escribirlo — no hay error, y `revisar-responsive.mjs` no lo ve porque mide
 * clases de Tailwind y esto se resuelve en tiempo de ejecución.
 *
 * El globo se dibuja en `fixed`, colgado del viewport, porque en `absolute`
 * cualquier ancestro con `overflow` lo recorta y en este sistema las tablas
 * viven adentro de un `overflow-x-auto`. Ver el encabezado de `InfoTip.tsx`.
 */

export const ANCHO_GLOBO = 260;
export const MARGEN_GLOBO = 8;

export interface Rectangulo {
  left: number;
  right: number;
  bottom: number;
}

export interface Globo {
  top: number;
  left: number;
  ancho: number;
}

/**
 * La posición del globo para un ícono que ocupa `icono` en la pantalla.
 *
 * Tres reglas, en este orden:
 *
 * 1. Pegado al ícono por la izquierda, que es lo que se espera al leer.
 * 2. Si así se saliera por el borde derecho, se alinea por la **derecha** del
 *    ícono. Es el caso de las últimas columnas de una tabla ancha.
 * 3. Pase lo que pase, adentro de la pantalla. En un teléfono el globo mide
 *    casi todo el ancho y las dos reglas de arriba no alcanzan.
 */
export function ubicarGlobo(icono: Rectangulo, anchoVentana: number): Globo {
  const ancho = Math.min(ANCHO_GLOBO, anchoVentana - MARGEN_GLOBO * 2);

  let left = icono.left;
  if (left + ancho + MARGEN_GLOBO > anchoVentana) left = icono.right - ancho;

  left = Math.max(MARGEN_GLOBO, Math.min(left, anchoVentana - ancho - MARGEN_GLOBO));

  return { top: icono.bottom + 6, left, ancho };
}
