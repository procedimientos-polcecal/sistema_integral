/**
 * Reconocer, por su nombre, algo que una planilla nombra en texto libre.
 *
 * Los catálogos del núcleo —`sectores`, `empresas`, `proveedores`, `empleados`—
 * los comparten los cinco módulos, y las planillas los nombran escribiéndolos.
 * Cómo se decide que "Producción" y "produccion" son el mismo, y qué se hace
 * cuando no se está seguro, tiene que ser una sola regla: si la importación de
 * RRHH acepta una cosa y la pantalla de administración otra, se crea un
 * duplicado que ninguna de las dos ve.
 *
 * LAS DOS DECISIONES QUE ESTÁN ACÁ
 *
 * **Sin tildes ni mayúsculas.** Es como se cuelan los duplicados: "Producción -
 * Hidratacion" convivió meses al lado de "Hidratación" sin que nadie los viera
 * como parejos, y la base no ayuda porque su índice único compara el texto tal
 * cual.
 *
 * **Un empate no resuelve a ninguno.** Si dos filas comparten nombre, la clave
 * queda apagada. Es lo contrario de `indicePorNombre` de Inventario, que se
 * queda con el primero que aparece y no avisa: elegir uno de dos es enlazar al
 * que se le parece, y el dato termina en el lugar que no es sin que nadie lo
 * note. Vale la pena revisar esa también cuando se toque el espejo de
 * Inventario.
 */

/** La clave con la que dos nombres son "el mismo" para una persona. */
export function claveDeNombre(nombre: string): string {
  return String(nombre ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * El índice de un catálogo por nombre. `null` marca la clave que empata.
 *
 * Se arma con las filas que se pueden elegir hoy —las activas—: un nombre
 * repetido por una fila dada de baja haría ambiguo algo que en realidad es uno
 * solo, y dejaría sin enlazar a todo el mundo.
 */
export function indiceDeCatalogo(
  filas: readonly { id: string; nombre: string }[]
): Map<string, string | null> {
  const indice = new Map<string, string | null>();
  for (const f of filas) {
    const k = claveDeNombre(f.nombre);
    if (!k) continue;
    // El segundo que llega no gana ni pierde: apaga la clave para los dos.
    indice.set(k, indice.has(k) ? null : f.id);
  }
  return indice;
}

/**
 * El id de lo que nombra la planilla, o `null` si no se lo reconoce con certeza.
 *
 * Dice además por qué, porque no se arreglan igual: un nombre que no existe se
 * resuelve corrigiendo la planilla o dando de alta la fila, y uno ambiguo se
 * resuelve en el catálogo. "No se pudo" a secas deja a alguien buscando cuál de
 * las dos cosas pasó.
 */
export function elQueNombra(
  indice: ReadonlyMap<string, string | null>,
  nombre: string
): { id: string | null; motivo?: "no existe" | "ambiguo" } {
  const k = claveDeNombre(nombre);
  if (!k || !indice.has(k)) return { id: null, motivo: "no existe" };
  const id = indice.get(k) ?? null;
  return id ? { id } : { id: null, motivo: "ambiguo" };
}
