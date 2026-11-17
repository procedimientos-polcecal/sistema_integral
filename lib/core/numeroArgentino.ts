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

/**
 * Lo que una persona tipeó en un campo, leído como número.
 *
 * **Es el envoltorio de `numeroArgentino` para un cuerpo que llega de una
 * pantalla**: trim, vacío es null, un número ya interpretado pasa derecho, y
 * cualquier otra cosa es null en vez de `NaN`. La regla de los miles la decide
 * `numeroArgentino` y acá no se repite.
 *
 * POR QUÉ ESTÁ EN EL NÚCLEO
 *
 * El 05/11/2026 se arregló en Calidad/Ensayos un bug que resultó ser de todo el
 * sistema: el navegador manda el número como el texto que se tipeó —"1,32"— y
 * la ruta lo leía con `Number()`, que da `NaN`. Sale por dos lados y el peor es
 * el que no frena: `JSON.stringify(NaN)` es `null`, así que el campo se guarda
 * vacío **después** de que la pantalla ya mostró el cálculo hecho con el número
 * bueno. Lo tienen que usar las dos puntas, el formulario y la ruta, porque la
 * causa de fondo no es el `Number()` sino que haya dos funciones leyendo la
 * misma cadena.
 *
 * Vive acá y no en un módulo por el criterio de `fechaDeSheets`: lo necesitan
 * tres que no se conocen —Inventario, Trituración y Cantera—, y tenerlo tres
 * veces es cómo se arregla en uno solo.
 *
 * CUÁNDO **NO** ES ÉSTA
 *
 * Cuando el punto no puede ser de miles porque la cantidad está acotada por la
 * física: la balanza de Calidad/Ensayos lee "299.668" como 299,668 g y no como
 * trescientos kilos, y para eso tiene su propia `numeroTipeado` en
 * `lib/calidad/ensayos/cuerpoDeLaMuestra.ts`. Acá se eligió la regla de miles
 * porque se midió que hace falta: los tipos de cambio de Cantera van de 1390 a
 * 1560 (54 de 54 pasan los mil), el monto por noche de sereno de 35.000 a
 * 40.000, y 11 de 159 partes de Trituración declaran más de mil toneladas —el
 * máximo es 1440—. Ahí "1.440" es mil cuatrocientos cuarenta.
 */
export function numeroDelFormulario(v: unknown): number | null {
  if (typeof v === "number") return isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const limpio = v.trim();
  if (limpio === "") return null;
  return numeroArgentino(limpio);
}
