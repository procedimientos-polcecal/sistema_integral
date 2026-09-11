/**
 * El nombre de una columna de Sheets a partir de su índice: 0 → A.
 *
 * Vive solo, en el núcleo, por dos razones. Una es que lo necesitan Compras y
 * Mantenimiento y había **tres implementaciones**, dos de ellas rotas: las de
 * `compras/comparativa.ts` y `compras/sheets.ts` eran
 * `String.fromCharCode(65 + i)`, que a partir de la 27 devuelve `[`, `\` y `]`
 * en vez de AA, AB y AC. Un rango con esas letras no apunta a la columna
 * equivocada: Google lo rechaza, y el error que se ve no dice que el problema
 * es la letra.
 *
 * La otra es que no arrastra nada. `core/sheets.ts` importa `core/google.ts`,
 * que lee variables de entorno y firma un JWT; `compras/comparativa.ts` es a
 * propósito un módulo sin red, que se prueba sin credenciales. Sacar la función
 * a un archivo propio deja que los dos la usen sin que uno se lleve las
 * dependencias del otro.
 *
 * Un índice negativo no devuelve nada parecido a una letra: revienta. Ya pasó
 * al revés —la versión vieja convertía el -1 de "esta columna no existe" en
 * `@`, y la fórmula del total salía `...+@1001` para que Excel la marcara como
 * error mucho después—. Hoy todos los llamadores comprueban `>= 0` antes de
 * llegar acá; esto está para que si mañana uno se olvida, se vea en el momento
 * y no en la planilla de alguien.
 */
export function letraDeColumna(indice: number): string {
  if (!Number.isInteger(indice) || indice < 0) {
    throw new Error(
      `letraDeColumna(${indice}): no es un índice de columna. ` +
      "Un -1 suele significar que esa columna no está en el encabezado: " +
      "hay que comprobarlo antes de armar el rango."
    );
  }

  let s = "";
  for (let i = indice + 1; i > 0; i = Math.floor((i - 1) / 26)) {
    s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  }
  return s;
}

/**
 * El camino de vuelta: `A` → 0, `AA` → 26.
 *
 * Hace falta para leer un rango que ya está armado. Cuando una escritura vuelve
 * rechazada, lo único que queda del destino es el `RI MANTENIMIENTO!P947` que se
 * le mandó a Google, y para preguntarle a la planilla qué protege esa celda hay
 * que volver de la letra al índice —que es como la API numera las columnas—.
 *
 * Vive acá, al lado de su gemela, por lo mismo que ella: no es una conversión
 * que convenga reescribir en cada lugar que la necesite. Fuera del alfabeto no
 * inventa un número: devuelve -1, que es lo que el resto del código ya sabe leer
 * como "esta columna no existe".
 */
export function indiceDeColumna(letras: string): number {
  const limpio = (letras ?? "").trim().toUpperCase();
  if (!/^[A-Z]+$/.test(limpio)) return -1;

  let n = 0;
  for (const letra of limpio) n = n * 26 + (letra.charCodeAt(0) - 64);
  return n - 1;
}
