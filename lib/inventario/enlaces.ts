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

/** Un catálogo del núcleo, indexado por su nombre normalizado. */
export type Indice = Map<string, string>;

/**
 * Arma el índice de un catálogo.
 *
 * Se normaliza con la misma regla que usa el padrón de proveedores —sin
 * acentos, sin mayúsculas, sin puntos, espacios colapsados— porque el problema
 * es el mismo en los tres: "Candia" y "CANDIA" son uno solo.
 *
 * El primero gana: si dos filas normalizan igual, la segunda es un duplicado y
 * elegirla cambiaría el resultado según el orden en que vinieron.
 */
export function indicePorNombre(filas: { id: string; nombre: string }[]): Indice {
  const indice: Indice = new Map();
  for (const f of filas) {
    const k = claveDeProveedor(f.nombre);
    if (k && !indice.has(k)) indice.set(k, f.id);
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
      if (k && !indice.has(k)) indice.set(k, f.id);
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
