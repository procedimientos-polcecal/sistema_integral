/**
 * Qué nombres de proveedor escribe hoy la planilla de Compras.
 *
 * Existe para una sola pregunta, que es la que decide una fusión de
 * duplicados: **si borro esta fila del padrón, ¿la planilla la vuelve a
 * crear?** `asegurarProveedores()` crea la fila que no encuentra por nombre, así
 * que un nombre que la planilla escribe es un nombre que vuelve, y borrar su
 * fila sólo consigue que vuelva vacía y sin CUIT — con los pedidos nuevos
 * cayendo otra vez ahí.
 *
 * Medido el 26/11/2026 sobre los 105 grupos de duplicados: en **70** la
 * planilla escribe un solo nombre del grupo (la otra fila está inerte y se
 * puede borrar), en **15** no escribe ninguno, y en **20** escribe dos o más
 * —«RANDAZZO» y «FERRETERIA RANDAZZO»—, que son los que además piden unificar
 * la celda de la planilla o vuelven igual.
 *
 * ## Por qué cuenta por clave y no por texto
 *
 * Porque `claveProveedor()` es la que usa la sincronización para decidir si un
 * nombre ya existe: «ALBERDI» y «Alberdi» son **el mismo** para ella, y
 * contarlos como dos haría creer que la planilla escribe dos nombres cuando
 * escribe uno. Ése es justo el caso de 70 de los 105 grupos, o sea que
 * equivocarse acá da vuelta la respuesta de la mayoría.
 */

import { claveProveedor } from "./sheets";

export interface NombreDeLaPlanilla {
  /** Cuántas celdas lo nombran, en todas las pestañas por área. */
  veces: number;
  /** Las formas en que está escrito, para poder mostrarlas. */
  formas: string[];
  /** El N° de RI más alto que lo nombra: dice si es un nombre vivo o viejo. */
  ultimoRi: number;
}

/**
 * Cuenta los nombres de la columna PROVEEDOR, indexados por su clave.
 *
 * Recibe las filas ya leídas —`[nombre, nroRi]` por celda— para que esto sea
 * puro: el viaje a Google lo hace la ruta.
 */
export function contarNombresDeLaPlanilla(
  celdas: readonly { nombre: string; nroRi?: string | number | null }[]
): Map<string, NombreDeLaPlanilla> {
  const porClave = new Map<string, NombreDeLaPlanilla>();

  for (const celda of celdas) {
    const nombre = String(celda.nombre ?? "").trim();
    if (!nombre) continue;

    const clave = claveProveedor(nombre);
    if (!clave) continue;

    const ri = Number(String(celda.nroRi ?? "").replace(/\D/g, "")) || 0;
    const previo = porClave.get(clave);
    if (!previo) {
      porClave.set(clave, { veces: 1, formas: [nombre], ultimoRi: ri });
      continue;
    }
    previo.veces++;
    previo.ultimoRi = Math.max(previo.ultimoRi, ri);
    if (!previo.formas.includes(nombre)) previo.formas.push(nombre);
  }

  return porClave;
}

/** Lo que la pantalla necesita saber de una fila del padrón frente a la planilla. */
export interface SegunLaPlanilla {
  laNombra: boolean;
  veces: number;
  ultimoRi: number;
}

/**
 * Qué dice la planilla de cada fila de un grupo de duplicados.
 *
 * Devuelve además `nombresDistintos`: cuántas claves **diferentes** del grupo
 * escribe la planilla. Es el número que parte el trabajo en dos, y no la
 * cantidad de filas:
 *
 * - **0 o 1** → fusionar alcanza. Si es 1, la clave queda ocupada por la fila
 *   que sobrevive, así que la sincronización no crea nada nuevo.
 * - **2 o más** → la planilla escribe dos nombres para la misma empresa y la
 *   que se borre vuelve. Primero se unifica la celda allá.
 */
export function loQueDiceLaPlanilla(
  filas: readonly { id: string; nombre: string }[],
  planilla: Map<string, NombreDeLaPlanilla>
): { porFila: Record<string, SegunLaPlanilla>; nombresDistintos: number } {
  const porFila: Record<string, SegunLaPlanilla> = {};
  const claves = new Set<string>();

  for (const fila of filas) {
    const clave = claveProveedor(fila.nombre);
    const dato = clave ? planilla.get(clave) : undefined;
    if (dato) claves.add(clave);
    porFila[fila.id] = {
      laNombra: Boolean(dato),
      veces: dato?.veces ?? 0,
      ultimoRi: dato?.ultimoRi ?? 0,
    };
  }

  return { porFila, nombresDistintos: claves.size };
}
