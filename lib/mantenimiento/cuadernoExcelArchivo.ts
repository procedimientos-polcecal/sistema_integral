import type ExcelJS from "exceljs";
import { abrirLibro } from "@/lib/core/excel";
import {
  interpretarExcel,
  type CeldaDelExcel, type FilaDelExcel, type LecturaDelExcel, type ValorDeCelda,
} from "./cuadernoExcel";

/**
 * Abrir el `.xlsx` del cuaderno: de bytes a las filas que lee `cuadernoExcel`.
 *
 * Está aparte del intérprete a propósito. Todo lo que decide —qué es un
 * renglón, qué es un grupo, si la cuenta cierra— vive en `cuadernoExcel.ts` y
 * se prueba con filas escritas a mano, sin armar un archivo. Acá sólo queda lo
 * que no se puede probar sin `exceljs`: aplanar lo que devuelve y elegir la
 * hoja.
 *
 * **No se usa `leerLibro()` de `lib/core/excel.ts`**, que es el lector común
 * del repo, y la razón es la que define este archivo: ese lector **aplana las
 * fórmulas a su resultado**, porque los cinco importadores que lo usan sólo
 * quieren el valor. Acá la fórmula **es el dato**: `=C47+C50+C51` en la columna
 * N es lo que dice qué renglones van juntos en una OT. Aplanarla deja un 46 sin
 * ninguna forma de saber de dónde salió, y no habría grupos.
 *
 * Lo que sí se comparte con ese archivo es **abrir** el libro (`abrirLibro`),
 * que lleva el segundo intento sin prefijos de namespace: ahí no hay nada
 * propio del cuaderno, y tener dos copias de ese reintento significaría
 * arreglarlo dos veces el día que aparezca otro XML raro.
 *
 * LA HOJA: se prueban todas y gana la primera que tenga el encabezado
 * «Fecha / Tarea». Un libro con una hoja —que es el caso medido— no cambia; uno
 * con la plantilla en la segunda hoja, o con una hoja de notas adelante, entra
 * igual en vez de fallar por el orden. Si ninguna tiene el encabezado, se
 * devuelve el error de la primera, que es el que nombra lo que sí había.
 */

/** Lo que `exceljs` devuelve en `cell.value`, antes de aplanarlo. */
type ValorDeExcelJS =
  | null
  | undefined
  | string
  | number
  | boolean
  | Date
  | { error: string }
  | { richText: Array<{ text?: string }> }
  | { text?: string; hyperlink?: string }
  | { formula?: string; sharedFormula?: string; result?: unknown }
  | Record<string, unknown>;

/**
 * Una celda de `exceljs` a la forma que espera el intérprete.
 *
 * `exceljs` es más expresivo que un valor pelado: un texto con formato llega
 * como `{ richText }`, un enlace como `{ text, hyperlink }`, un error como
 * `{ error }` y una fórmula como `{ formula, result }`. Lo único que acá se
 * conserva entero es la **fórmula**; el resto se lleva a texto o número.
 */
function aplanar(valor: ValorDeExcelJS): CeldaDelExcel {
  if (valor === null || valor === undefined) return null;
  if (valor instanceof Date) return valor;
  if (typeof valor !== "object") return valor;

  if ("error" in valor && typeof valor.error === "string") return { error: valor.error };

  if ("richText" in valor && Array.isArray(valor.richText)) {
    return valor.richText.map((t) => t?.text ?? "").join("");
  }

  // Una fórmula compartida (`sharedFormula`) es la misma fórmula trasladada: la
  // celda maestra trae `formula` y las que siguen traen sólo la referencia a
  // ella. Las dos son una fórmula para lo que importa acá — que la celda no es
  // un número escrito a mano—, así que entran las dos.
  if ("formula" in valor || "sharedFormula" in valor) {
    const formula = typeof valor.formula === "string" && valor.formula
      ? valor.formula
      : typeof valor.sharedFormula === "string"
        ? valor.sharedFormula
        : "";
    const crudo = (valor as { result?: unknown }).result;
    const plano = crudo === undefined ? undefined : aplanar(crudo as ValorDeExcelJS);
    // El resultado de una fórmula no puede ser otra fórmula: si lo fuera, se
    // tira, porque el intérprete lo leería como «sin valor calculado» y es lo
    // que corresponde.
    const anidada =
      plano !== null && plano !== undefined && typeof plano === "object"
      && !(plano instanceof Date) && "formula" in plano;
    const resultado = anidada ? undefined : (plano as ValorDeCelda | { error: string } | undefined);
    return { formula, resultado };
  }

  if ("text" in valor && typeof valor.text === "string") return valor.text;

  return null;
}

/** Las filas de una hoja, con el número de fila del Excel y las celdas por letra. */
export function filasDeLaHoja(hoja: ExcelJS.Worksheet): FilaDelExcel[] {
  const filas: FilaDelExcel[] = [];
  hoja.eachRow({ includeEmpty: false }, (fila, numero) => {
    const celdas: Record<string, CeldaDelExcel> = {};
    fila.eachCell({ includeEmpty: false }, (celda) => {
      // `address` es «C47»: la letra sale de ahí y no de contar columnas, que es
      // el off-by-one que ya costó seis OT escritas en la columna del equipo.
      const letra = String(celda.address ?? "").replace(/\d+$/, "");
      if (!letra) return;
      const plano = aplanar(celda.value as ValorDeExcelJS);
      if (plano !== null) celdas[letra] = plano;
    });
    filas.push({ fila: numero, celdas });
  });
  return filas;
}

/** El `.xlsx` entero, leído e interpretado. */
export async function interpretarArchivo(bytes: ArrayBuffer | Uint8Array): Promise<LecturaDelExcel> {
  // `abrirLibro` y no `libro.xlsx.load` a secas: trae el segundo intento sin
  // prefijos de namespace que los cinco importadores del repo ya necesitaron.
  // Un .xlsx que no escribió Excel puede traerlos, y `exceljs` compara los tags
  // del XML letra por letra.
  let libro: ExcelJS.Workbook;
  try {
    libro = await abrirLibro(bytes);
  } catch (e) {
    const porque = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `No se pudo abrir el archivo: ${porque}` };
  }

  if (libro.worksheets.length === 0) return { ok: false, error: "El archivo no tiene ninguna hoja." };

  let primerError: LecturaDelExcel | null = null;
  for (const hoja of libro.worksheets) {
    const lectura = interpretarExcel(filasDeLaHoja(hoja));
    if (lectura.ok) return lectura;
    if (!primerError) primerError = lectura;
  }
  return primerError!;
}
