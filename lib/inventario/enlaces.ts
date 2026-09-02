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
