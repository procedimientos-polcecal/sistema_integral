/**
 * Qué clase de archivo de equipos nos dieron.
 *
 * Hay dos que circulan y no se parecen en nada: el **libro BD Equipos**, con
 * una hoja por tabla y nombres de columna en snake_case, y una **planilla
 * plana**, una fila por equipo con los encabezados en castellano. Pedirle a
 * alguien que convierta el suyo al otro formato es pedirle que haga a mano un
 * trabajo que la máquina puede hacer sola.
 */

import { normalizar } from "@/lib/mantenimiento/planilla";

export type Formato = "libro" | "planilla" | "desconocido";

/** Las hojas del libro que el importador sabe leer. */
export const HOJAS_DEL_LIBRO = ["TIPO_EQUIPO", "SECTORES", "EQUIPOS", "COMPONENTES"] as const;

/** Compara nombres de hoja o de columna sin acentos ni mayúsculas. */
const clave = (v: unknown): string => normalizar(v).replace(/[\s-]+/g, "_");

/** La hoja que se llama así, sin importar acentos ni mayúsculas. */
export function buscarHoja(hojas: string[], nombre: string): string | null {
  const buscado = clave(nombre);
  return hojas.find((h) => clave(h) === buscado) ?? null;
}

/**
 * De qué formato es el archivo.
 *
 * El libro se reconoce por tener una hoja `EQUIPOS` **y** que esa hoja hable en
 * el idioma del libro (`equipo_id`). Mirar sólo el nombre de la hoja no
 * alcanza: una planilla plana puede llamarse igual.
 */
export function detectarFormato(
  hojas: string[],
  columnasDeEquipos: string[]
): Formato {
  const columnas = new Set(columnasDeEquipos.map(clave));

  if (buscarHoja(hojas, "EQUIPOS") && columnas.has("equipo_id")) return "libro";

  // La planilla plana: alcanza con que diga el código y el nombre de cada
  // equipo, sea como sea que los llame.
  const tieneCodigo = ["codigo", "code", "equipo_id"].some((c) => columnas.has(c));
  const tieneNombre = ["nombre", "name", "nombre_equipo"].some((c) => columnas.has(c));

  return tieneCodigo && tieneNombre ? "planilla" : "desconocido";
}

/**
 * Qué le falta al archivo para poder importarse.
 *
 * Se devuelve como texto para la pantalla: un "no se pudo importar" a secas
 * obliga a adivinar, y lo que hay que decir es qué columna falta.
 */
export function porQueNoSePuede(hojas: string[], columnasDeEquipos: string[]): string {
  const hoja = buscarHoja(hojas, "EQUIPOS");

  if (!hoja && hojas.length > 0) {
    return (
      `El archivo no tiene ninguna hoja de equipos. Tiene: ${hojas.join(", ")}. ` +
      "Se espera el libro BD Equipos —con las hojas EQUIPOS, SECTORES, TIPO_EQUIPO y " +
      "COMPONENTES— o una planilla con una fila por equipo."
    );
  }

  return (
    "No se reconocieron las columnas. Hace falta el código y el nombre de cada equipo: " +
    `en el libro son "equipo_id" y "nombre_equipo"; en una planilla, "Código" y "Nombre". ` +
    (columnasDeEquipos.length > 0
      ? `El archivo trae: ${columnasDeEquipos.slice(0, 12).join(", ")}.`
      : "La hoja está vacía.")
  );
}
