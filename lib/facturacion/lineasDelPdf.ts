/**
 * Sacar el detalle de una factura del texto del PDF.
 *
 * El QR **no trae las líneas**: trae la cabecera —emisor, número, fecha, total—
 * y nada más. Para tener una línea por producto no hay otra que leer el texto
 * del comprobante, y ahí cada proveedor imprime como quiere.
 *
 * ## Por qué esto funciona sin una plantilla por proveedor
 *
 * Porque no se interpreta el diseño: se busca **aritmética que cierre**. Una
 * fila de detalle tiene tres números al final —cantidad, precio unitario y
 * total— y el tercero es el producto de los dos primeros. Esa relación no
 * depende de dónde estén las columnas ni de cómo se llame el encabezado, y una
 * fila que no la cumple simplemente no es una línea de detalle.
 *
 * Y hay una segunda red, independiente de la primera: **la suma de las líneas
 * tiene que dar el neto del comprobante**, que ya se conoce por el QR. Si no da,
 * la lectura no se usa. Dos controles que fallan por motivos distintos son
 * mucho más que dos controles.
 *
 * ## Lo que enseñó la primera factura real (11/09/2026)
 *
 * De ALMENTA JUAN CARLOS, cuatro ítems:
 *
 * - **El producto de la fila no da exacto.** `CONDUCTOR CHATO 3x2.5mm`,
 *   20 × 4.426,45 = 88.529,00 y el papel dice **88.528,93**. Siete centavos. Un
 *   control estricto la habría descartado, así que la tolerancia es relativa y
 *   no de igualdad.
 * - **La descripción trae números que no son columnas.** `428X4/7.5`,
 *   `3x2.5mm`. Por eso se toman **los últimos tres** números de la fila y no los
 *   primeros que aparezcan.
 * - **El pie imita una línea de detalle.** `I.V.A. 10,5% 0,00 0,00` cumple la
 *   aritmética —10,5 × 0 = 0— y no es un producto. Por eso una línea con importe
 *   cero no se acepta nunca.
 * - **El PDF dibuja cada texto dos veces.** Sin deduplicar, cada fila llega
 *   repetida y los últimos tres números son los de la segunda copia.
 */

/** Una fila de detalle reconocida en el comprobante. */
export interface LineaDelComprobante {
  descripcion: string;
  cantidad: number;
  precioUnitario: number;
  /** El importe de la fila tal como está impreso, que manda sobre el producto. */
  total: number;
}

export interface LecturaDeLineas {
  lineas: LineaDelComprobante[];
  /** Lo que suman las líneas encontradas. */
  sumado: number;
  /**
   * Si la suma cuadra con el neto del comprobante. Cuando es `false` el detalle
   * **no se usa**: es preferible una sola línea por el total que un detalle que
   * no representa la factura.
   */
  cuadra: boolean;
  /** Por qué no se pudo, cuando no se pudo. */
  motivo: string | null;
}

/**
 * Los números de una fila, en orden de aparición.
 *
 * Formato argentino: `1.234,56`. También se aceptan `1234,56` y `1234.56`, que
 * aparecen en los totales que algunos emisores imprimen sin separador de miles
 * (`Subtotal 1466699,26`).
 */
export function numerosDeLaFila(texto: string): number[] {
  const encontrados: number[] = [];

  for (const m of texto.matchAll(/\d{1,3}(?:\.\d{3})+,\d+|\d+,\d+|\d+\.\d+|\d+/g)) {
    const crudo = m[0];
    let normalizado: string;

    if (/,/.test(crudo)) {
      // Coma decimal: el punto es separador de miles.
      normalizado = crudo.replace(/\./g, "").replace(",", ".");
    } else {
      normalizado = crudo;
    }

    const valor = Number(normalizado);
    if (Number.isFinite(valor)) encontrados.push(valor);
  }

  return encontrados;
}

/**
 * Palabras con las que arranca el pie del comprobante.
 *
 * Se miran además de la aritmética, no en vez de ella: son el segundo motivo por
 * el que `I.V.A. 10,5% 0,00 0,00` no entra como producto.
 */
const PIE = /^(sub\s*total|subtotal|total|iva|i\.v\.a|neto|gravado|no gravado|exento|bonificaci|descuento|recargo|percepci|retenci|impuesto|c\.a\.e|cae\b|importe|son pesos)/i;

/** Lo que hace falta para creerle a una fila. Relativo, no absoluto: ver arriba. */
const TOLERANCIA = 0.005;

function cierraLaCuenta(cantidad: number, precio: number, total: number): boolean {
  const esperado = cantidad * precio;
  if (esperado === 0) return total === 0;
  return Math.abs(esperado - total) / Math.abs(esperado) <= TOLERANCIA;
}

/**
 * Interpretar una fila como línea de detalle, o `null` si no lo es.
 *
 * Los tres números que se miran son **los últimos**, porque la descripción de un
 * producto trae números propios que no son columnas (`428X4/7.5`).
 */
export function interpretarFila(texto: string): LineaDelComprobante | null {
  const limpio = texto.replace(/\s+/g, " ").trim();
  if (!limpio || PIE.test(limpio)) return null;

  const numeros = numerosDeLaFila(limpio);
  if (numeros.length < 3) return null;

  const [cantidad, precioUnitario, total] = numeros.slice(-3);

  /*
   * Una línea sin importe no es un producto: es el pie del comprobante
   * imitando uno. `I.V.A. 10,5% 0,00 0,00` cumple la aritmética.
   */
  if (!(cantidad > 0) || !(precioUnitario > 0) || !(total > 0)) return null;
  if (!cierraLaCuenta(cantidad, precioUnitario, total)) return null;

  /*
   * La descripción es lo que está antes del primero de los tres números, y se
   * lo busca **desde el final**: si la descripción repite el mismo texto que la
   * cantidad, lo que vale es la última aparición, que es la columna.
   */
  const posicion = posicionDeLosNumerosFinales(limpio);
  if (posicion === null) return null;

  const descripcion = limpio.slice(0, posicion).replace(/[\s|:·-]+$/, "").trim();
  // Sin descripción no hay nada que reconocer, y un resto de una o dos letras es
  // el borde de una tabla, no el nombre de un producto.
  if (descripcion.length < 3) return null;

  return { descripcion, cantidad, precioUnitario, total };
}

/** Dónde arranca, en el texto, el primero de los tres números finales. */
function posicionDeLosNumerosFinales(texto: string): number | null {
  const coincidencias = [...texto.matchAll(/\d{1,3}(?:\.\d{3})+,\d+|\d+,\d+|\d+\.\d+|\d+/g)];
  if (coincidencias.length < 3) return null;
  return coincidencias[coincidencias.length - 3].index ?? null;
}

/**
 * Quitar la repetición que dejan los PDF que dibujan cada texto dos veces.
 *
 * Se hace sobre la fila ya armada y no sobre los fragmentos porque la
 * duplicación no siempre es fragmento a fragmento: a veces el emisor dibuja la
 * fila entera dos veces, corrida un punto.
 */
export function sinRepetir(texto: string): string {
  const limpio = texto.replace(/\s+/g, " ").trim();
  const mitad = Math.floor(limpio.length / 2);

  if (limpio.length % 2 === 1 && limpio[mitad] === " ") {
    const izquierda = limpio.slice(0, mitad);
    const derecha = limpio.slice(mitad + 1);
    if (izquierda === derecha) return izquierda;
  }

  return limpio;
}

/**
 * El detalle de la factura, si se lo puede leer con confianza.
 *
 * `netoEsperado` es el del comprobante —el total del QR menos el IVA—, y es lo
 * que decide si el detalle se usa o se descarta. Sin él se devuelven las líneas
 * igual, pero marcadas como que no cuadran: nadie las confirmó contra nada.
 */
export function buscarLineas(
  filas: string[],
  opciones: { netoEsperado?: number | null } = {}
): LecturaDeLineas {
  const lineas: LineaDelComprobante[] = [];

  for (const fila of filas) {
    const linea = interpretarFila(sinRepetir(fila));
    if (linea) lineas.push(linea);
  }

  const sumado = Math.round(lineas.reduce((a, l) => a + l.total, 0) * 100) / 100;

  if (lineas.length === 0) {
    return { lineas, sumado: 0, cuadra: false, motivo: "No se reconoció ninguna línea de detalle." };
  }

  const neto = opciones.netoEsperado;
  if (neto === null || neto === undefined) {
    return {
      lineas,
      sumado,
      cuadra: false,
      motivo: "No se sabe el neto del comprobante, así que no hay contra qué controlar la suma.",
    };
  }

  /*
   * Un centavo por línea es lo que puede aportar el redondeo de cada fila; se
   * acepta eso o el 0,5%, lo que sea más grande. Más que eso significa que se
   * leyó de más o de menos, y entonces el detalle no representa la factura.
   */
  const margen = Math.max(0.01 * lineas.length, Math.abs(neto) * TOLERANCIA);
  const cuadra = Math.abs(sumado - neto) <= margen;

  return {
    lineas,
    sumado,
    cuadra,
    motivo: cuadra
      ? null
      : `Las líneas suman ${sumado} y el neto del comprobante es ${neto}: falta o sobra algo, así que no se usan.`,
  };
}
