/**
 * Reconocer contra el núcleo lo que la planilla nombra en texto.
 *
 * El kardex dice "MANTENIMIENTO", "Lopez", "Acme SA": nombres escritos a mano,
 * cada vez. El SdG ya tiene sectores, empleados y proveedores, y el trabajo es
 * cruzarlos.
 *
 * **Los catálogos no se crean desde acá.** Es la diferencia más importante con
 * el importador del repo de origen, que arranca con `delete from sectores`,
 * `equipos`, `empleados` y `proveedores` y los rehace. En el SdG esas cuatro
 * tablas las comparten RRHH, Mantenimiento, Remises y Compras: crear una fila
 * por cada variante mal tipeada que aparezca en una planilla del almacén
 * llenaría la lista que usan los otros cuatro módulos. Lo que no se reconoce
 * queda en null y se informa, igual que decidió la 032 para proveedores.
 */

import { claveDeProveedor } from "@/lib/core/proveedores";

/**
 * Un catálogo del núcleo, indexado por su nombre normalizado.
 *
 * `null` marca la clave que empata: dos filas se llaman igual y ninguna gana.
 */
export type Indice = Map<string, string | null>;

/**
 * Arma el índice de un catálogo.
 *
 * Se normaliza con la misma regla que usa el padrón de proveedores —sin
 * acentos, sin mayúsculas, sin puntos, espacios colapsados— porque el problema
 * es el mismo en los tres: "Candia" y "CANDIA" son uno solo.
 *
 * Si dos filas normalizan igual, la clave no resuelve a ninguna.
 *
 * Antes ganaba la primera, con este argumento: elegir la segunda dependería del
 * orden en que vinieron. El argumento no se sostiene —elegir la primera depende
 * igual, y PostgREST no promete un orden—, y sobre todo contradice la regla que
 * este mismo archivo aplica en todo lo demás: enlazar al que se le parece es
 * peor que dejar en null, porque el dato aparece en el lugar que no es y no se
 * nota nunca. Un empate es justamente no reconocerlo con certeza.
 *
 * Hoy no cambia nada: los cuatro catálogos que se indexan acá —29 sectores, 289
 * proveedores, 21 destinos, 64 solicitantes— no tienen un solo empate. Cambia
 * el día que alguien cargue el duplicado, que es cuando importa.
 */
export function indicePorNombre(filas: { id: string; nombre: string }[]): Indice {
  const indice: Indice = new Map();
  for (const f of filas) {
    const k = claveDeProveedor(f.nombre);
    if (!k) continue;
    // Se compara contra el id y no contra la clave: la misma fila entrando dos
    // veces no es un empate, son dos formas de nombrarla.
    indice.set(k, indice.has(k) && indice.get(k) !== f.id ? null : f.id);
  }
  return indice;
}

/**
 * El índice de empleados, que necesita las dos formas de escribir un nombre.
 *
 * `indicePorNombre` sobre `empleados` no reconocía **ninguno** de los 3.794
 * movimientos con solicitante, y la razón es tonta: la tabla guarda el nombre y
 * el apellido en columnas separadas, así que el índice quedaba armado con
 * "Fabricio" mientras la planilla escribe "GALLASTEGUI, Fabricio". Cero de
 * 3.794.
 *
 * Y no alcanza con una sola forma, porque en la planilla conviven las dos:
 * "VARELA, Francisco Enrique" y "Augusto Candia". Cada empleado entra con las
 * dos —la coma la borra la normalización, así que "apellido, nombre" y
 * "apellido nombre" son la misma clave—. Con eso se reconocen 2.835 de 3.794.
 *
 * Los 959 restantes **quedan en null a propósito**. Son "Omar Piparo" y
 * "Sebastian" —que no están en el padrón—, "REGULADOR" y "OFICINAS" —que no son
 * personas—, y "Lopez Raul" contra "LOPEZ, Raul Argentino", donde acertar
 * requiere saber que no hay otro López. Enlazar al que se le parece es peor que
 * dejar vacío: el dato aparece en el legajo de otro y nadie lo nota.
 */
export function indiceDeEmpleados(
  filas: { id: string; nombre: string; apellido?: string | null }[]
): Indice {
  const indice: Indice = new Map();
  for (const f of filas) {
    const nombre = String(f.nombre ?? "").trim();
    const apellido = String(f.apellido ?? "").trim();
    const formas = apellido
      ? [`${apellido} ${nombre}`, `${nombre} ${apellido}`]
      : [nombre];

    for (const forma of formas) {
      const k = claveDeProveedor(forma);
      if (!k) continue;
      // Dos empleados que se escriben igual no resuelven a ninguno. Las dos
      // formas de un mismo empleado sí, porque el id es el mismo: "LOPEZ, Raul"
      // y "Raul LOPEZ" son la misma persona, "Raul Lopez" y otro "Raul Lopez"
      // no, y ahí acertar requiere saber que no hay dos.
      indice.set(k, indice.has(k) && indice.get(k) !== f.id ? null : f.id);
    }
  }
  return indice;
}

/** El id del catálogo para ese nombre, o null si no se lo reconoce. */
export function reconocer(indice: Indice, nombre: string | null | undefined): string | null {
  const k = claveDeProveedor(nombre);
  return k ? indice.get(k) ?? null : null;
}

/**
 * Si el nombre no se reconoció porque hay más de uno que se llama así.
 *
 * Sirve para decirlo aparte de "no existe": no se arreglan igual. Un nombre que
 * no está se resuelve dándolo de alta o corrigiendo la planilla; uno repetido
 * se resuelve en el catálogo, y hasta que se resuelva ninguna de las dos filas
 * va a enganchar nada. Un diagnóstico que no se distingue de otro no es un
 * diagnóstico.
 */
export function esAmbiguo(indice: Indice, nombre: string | null | undefined): boolean {
  const k = claveDeProveedor(nombre);
  return Boolean(k) && indice.get(k) === null;
}

/**
 * Lo que la planilla nombró y el núcleo no tiene.
 *
 * Se junta para poder decirlo en pantalla en vez de que desaparezca. Un enlace
 * que falta y nadie ve es un reporte que miente sin avisar.
 */
export class SinReconocer {
  private readonly vistos = new Map<string, Set<string>>();

  anotar(catalogo: string, nombre: string | null | undefined): void {
    const s = String(nombre ?? "").trim();
    if (!s || s === "-") return;
    if (!this.vistos.has(catalogo)) this.vistos.set(catalogo, new Set());
    this.vistos.get(catalogo)!.add(s);
  }

  /** Los nombres sin reconocer por catálogo, ordenados. */
  resumen(): Record<string, string[]> {
    const salida: Record<string, string[]> = {};
    for (const [catalogo, nombres] of this.vistos) {
      if (nombres.size > 0) salida[catalogo] = [...nombres].sort();
    }
    return salida;
  }
}
