/**
 * En qué orden se muestran los avisos.
 *
 * ── POR QUÉ NO ALCANZA CON `.sort()` ──────────────────────────────────────
 *
 * El N° de aviso es **texto** (`oa_number`), no un número: los 254 que hay
 * tienen la forma `A1` … `A254` —medido el 19/11/2026: una sola forma, sin
 * nulos y sin repetidos—. Ordenar ese texto como texto da
 * `A1, A10, A100, …, A97, A98, A99`, o sea que **el aviso más nuevo queda en
 * el medio de la lista** y el orden no sirve para nada. Hay que separar el
 * prefijo del número y comparar el número como número.
 *
 * ── POR QUÉ EL NÚMERO SE COMPARA COMO DÍGITOS Y NO CON `Number()` ─────────
 *
 * Porque `Number()` pierde precisión arriba de 2^53 y dos números distintos
 * pasarían a ser iguales, sin avisar. Comparar las tiras de dígitos —primero
 * por largo, después alfabéticamente— es exacto para cualquier largo y de
 * paso resuelve solo los ceros a la izquierda (`A007` y `A7` quedan iguales,
 * que es lo correcto). Hoy el máximo es 254 y nada de esto haría falta; el
 * punto es que la función no tenga un techo que nadie recuerde.
 *
 * ── LAS DOS DECISIONES QUE NO SE DEDUCEN ──────────────────────────────────
 *
 * - **Lo que no tiene número va al final en las dos direcciones.** Si fuera
 *   "el más chico", dar vuelta el orden le pondría arriba de todo un montón
 *   de filas sin número, tapando justo lo que se fue a buscar. No tener
 *   número no es ser el primero. Es el mismo criterio que el
 *   `nullsFirst: false` con que el servidor pide los avisos.
 * - **Los empates conservan el orden en que venían.** `Array.prototype.sort`
 *   es estable, y lo que llega del servidor ya viene por fecha: así, dos
 *   filas con el mismo N° —que la planilla puede traer, el sync lo avisa—
 *   quedan con la más nueva arriba en vez de en un orden cualquiera.
 */

export type OrdenDeAvisos = "fecha" | "numero-asc" | "numero-desc";

/** Lo mínimo que esta función necesita saber de un aviso. */
interface Ordenable {
  oa_number: string | null;
  fecha: string | null;
}

/** El prefijo y los dígitos de un `A244`, o `null` si no tiene número. */
function partes(oa: string | null): { prefijo: string; digitos: string } | null {
  const texto = (oa ?? "").trim();
  const m = texto.match(/^(\D*?)(\d+)/);
  if (!m) return null;
  // Sin los ceros de la izquierda, para que el largo signifique magnitud.
  return { prefijo: m[1].toLowerCase(), digitos: m[2].replace(/^0+(?=\d)/, "") };
}

function compararNumero(a: string | null, b: string | null): number {
  const pa = partes(a);
  const pb = partes(b);
  if (!pa && !pb) return 0;
  if (!pa) return 1; // Lo que no tiene número, al final.
  if (!pb) return -1;

  if (pa.prefijo !== pb.prefijo) return pa.prefijo < pb.prefijo ? -1 : 1;
  if (pa.digitos.length !== pb.digitos.length) return pa.digitos.length - pb.digitos.length;
  return pa.digitos < pb.digitos ? -1 : pa.digitos > pb.digitos ? 1 : 0;
}

/**
 * Los avisos ordenados. **Devuelve un arreglo nuevo**: el que llega es la
 * prop que armó el servidor y ordenarlo en el lugar le cambia los datos a
 * quien lo pasó.
 */
export function ordenarAvisos<T extends Ordenable>(avisos: readonly T[], orden: OrdenDeAvisos): T[] {
  const copia = [...avisos];

  if (orden === "fecha") {
    // La misma regla con la que el servidor los pide —`fecha` descendente y
    // los sin fecha al final—, para que elegir esta opción devuelva de verdad
    // a como estaba y no a un orden parecido.
    return copia.sort((x, y) => {
      if (!x.fecha && !y.fecha) return 0;
      if (!x.fecha) return 1;
      if (!y.fecha) return -1;
      return x.fecha < y.fecha ? 1 : x.fecha > y.fecha ? -1 : 0;
    });
  }

  const signo = orden === "numero-asc" ? 1 : -1;
  return copia.sort((x, y) => {
    const sinX = partes(x.oa_number) === null;
    const sinY = partes(y.oa_number) === null;
    // Los sin número se quedan abajo aunque se invierta el resto.
    if (sinX || sinY) return sinX && sinY ? 0 : sinX ? 1 : -1;
    return signo * compararNumero(x.oa_number, y.oa_number);
  });
}
