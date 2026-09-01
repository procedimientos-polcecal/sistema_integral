/**
 * Un número escrito a mano, en convención argentina.
 *
 * Vive en el núcleo porque lo necesitan dos módulos que no se conocen —Compras
 * lo usa para leer los precios de una comparativa, RRHH para leer el valor hora
 * de un Excel de empleados— y tenerlo dos veces es cómo se corrige en uno solo.
 * Ya pasó: los dos tenían el mismo error y se arreglaron el mismo día.
 *
 * EL PROBLEMA
 *
 * El punto es ambiguo. En "3.500,50" es separador de miles y en "3500.5" es el
 * decimal, y no hay forma de saberlo mirando el carácter. Las dos
 * implementaciones elegían siempre decimal cuando no había coma, así que
 * **"3.500" —tres mil quinientos, como se escribe acá— entraba como 3,5**. En
 * RRHH eso es un valor hora de tres pesos con cincuenta, sin error y sin aviso,
 * visible recién en la liquidación.
 *
 * LA REGLA
 *
 *   1. Si están los dos separadores, el ÚLTIMO es el decimal. "1.500,50" es
 *      mil quinientos con cincuenta; "1,500.50" también.
 *   2. Si hay uno solo y aparece más de una vez, son miles: "1.234.567".
 *   3. Si hay uno solo y aparece una vez, es de miles cuando lo siguen
 *      exactamente tres dígitos y lo preceden entre uno y tres: "3.500" son
 *      tres mil quinientos. Cualquier otra cosa es un decimal, así que "3.5",
 *      "3500.55" y "3500.500" siguen andando —unos miles bien escritos serían
 *      "3.500.500"—.
 *   4. Un cero adelante desarma la regla de los miles: "0.500" es medio, no
 *      quinientos. Importa: el IVA se guarda como fracción y "0.210" tiene que
 *      seguir siendo 0,21 y no 210.
 *
 * Recibe el texto ya limpio de símbolos —sin "$", sin "%", sin espacios—:
 * decidir qué es basura y qué no depende de dónde venga el dato, y eso lo sabe
 * quien llama.
 */
export function numeroArgentino(limpio: string): number | null {
  if (limpio === "") return null;

  const ultimaComa = limpio.lastIndexOf(",");
  const ultimoPunto = limpio.lastIndexOf(".");

  let normalizado: string;

  if (ultimaComa >= 0 && ultimoPunto >= 0) {
    // (1) Están los dos: el último manda y el otro es de miles.
    normalizado = ultimaComa > ultimoPunto
      ? limpio.replace(/\./g, "").replace(",", ".")
      : limpio.replace(/,/g, "");
  } else if (ultimaComa >= 0) {
    normalizado = esDeMiles(limpio, ",")
      ? limpio.replace(/,/g, "")
      : limpio.replace(",", ".");
  } else if (ultimoPunto >= 0) {
    normalizado = esDeMiles(limpio, ".")
      ? limpio.replace(/\./g, "")
      : limpio;
  } else {
    normalizado = limpio;
  }

  const n = Number(normalizado);
  return isFinite(n) ? n : null;
}

/**
 * Si el separador que aparece está haciendo de miles y no de decimal.
 *
 * Grupos de tres dígitos de punta a punta, con uno a tres adelante. Cubre las
 * reglas (2) y (3); la (4) es el `!== "0"`.
 */
function esDeMiles(limpio: string, separador: "." | ","): boolean {
  const s = separador === "." ? "\\." : ",";
  const m = limpio.match(new RegExp(`^(-?\\d{1,3})(?:${s}\\d{3})+$`));
  return Boolean(m) && m![1] !== "0" && m![1] !== "-0";
}
