import { fechaDeSheets } from "@/lib/core/fechaDeSheets";
import { claveDeNombre } from "@/lib/core/catalogo";
import type { Producto } from "./types";

/**
 * Armar las filas de los resúmenes de la planilla. Sin red: todo lo que decide
 * dónde va cada número está acá para poder probarlo, y `espejo.ts` sólo lee,
 * llama y escribe.
 *
 * LA PLANILLA, RELEVADA
 *
 * Las tres pestañas de resumen tienen los encabezados en la **fila 4** y las
 * fechas en la columna A, de la **fila 5 a la 34** (treinta días: los meses de
 * 31 no entran, y eso se informa en vez de adivinarse).
 *
 * `Resumen Rotura` tiene además un segundo bloque con los porcentajes que
 * arranca en la columna S, marcado en la fila 3 con "% ROTURA / PRODUCCIÓN".
 * **Los nombres de los productos se repiten en los dos bloques**, así que buscar
 * el nombre en toda la fila de encabezados devolvería siempre el primero: por eso
 * `celdasDeResumen` recibe una ventana.
 */

/**
 * En qué fila de la pestaña va una fecha, o `null` si no tiene fila.
 *
 * Se busca por la fecha y no contando: contar da bien mientras la planilla esté
 * completa y da mal justo el día que le falta una fila.
 *
 * Una fecha que aparece dos veces (una fila duplicada a mano) es una
 * ambigüedad, no una fila: el mismo criterio que un nombre repetido en
 * `lib/core/catalogo.ts`. Elegir la primera sería enlazar a la que se parece,
 * y la otra fila duplicada quedaría sin actualizarse sin que nadie lo note.
 */
export function filaDeLaFecha(
  columnaA: readonly string[][],
  fecha: string,
  primeraFila: number
): number | null {
  let encontrada: number | null = null;
  for (let i = 0; i < columnaA.length; i++) {
    if (fechaDeSheets(columnaA[i]?.[0]) === fecha) {
      if (encontrada !== null) return null;
      encontrada = primeraFila + i;
    }
  }
  return encontrada;
}

/**
 * Dónde arranca el bloque de porcentajes, según el marcador de la fila 3.
 *
 * Busca el texto del marcador y no cualquier "%": un signo suelto en una nota
 * de otra celda, antes de la S, apuntaría al bloque equivocado sin avisar —lo
 * mismo que enlazar al que se parece— y sería peor que no encontrar nada.
 *
 * La comparación se hace por `claveDeNombre` (la misma regla del núcleo con la
 * que se decide que "Producción - Hidratacion" e "Hidratación" son el mismo
 * nombre): sin tildes, en minúsculas y con los espacios colapsados. Un doble
 * espacio tipeado a mano o una tilde puesta distinta en Sheets no pueden dejar
 * este bloque sin escribirse en silencio. El "%" queda afuera del marcador a
 * propósito —buscarlo fue lo que hacía frágil la versión anterior—, así que un
 * falso positivo pediría que otra celda contenga el texto largo y específico
 * "rotura / produccion", algo casi imposible; no encontrarlo, en cambio, deja
 * de escribir el bloque entero sin que nadie se entere.
 */
export function comienzoDelBloqueDePorcentaje(fila3: readonly string[]): number | null {
  const marcador = claveDeNombre("ROTURA / PRODUCCIÓN");
  const i = fila3.findIndex((c) => claveDeNombre(String(c ?? "")).includes(marcador));
  return i === -1 ? null : i;
}

export interface CeldaDeResumen {
  /** Índice de columna en base 0: A = 0. */
  columna: number;
  valor: string;
}

export interface FilaDeResumen {
  celdas: CeldaDeResumen[];
  /** Productos exportables cuya columna la planilla no tiene. No se adivina. */
  sinColumna: string[];
}

export interface OpcionesDeResumen {
  /** Primera columna del bloque, en base 0. Por defecto 1 (la B). */
  desde?: number;
  /** Primera columna ya fuera del bloque. Por defecto, el largo de los encabezados. */
  hasta?: number;
  /**
   * Qué escribir cuando el producto no tiene valor en el mapa. Por defecto `"cero"`.
   *
   * `"cero"` para **despacho y rotura**: un producto sin renglón de despacho
   * despachó cero, y eso es cierto.
   *
   * `"vacio"` para **producción**: un producto que no está en el mapa es uno que
   * `soloLoCalculado` dejó afuera porque no se pudo calcular —falta el parte
   * anterior, o falta un turno del día—. Un 0 ahí devuelve por la ventana
   * exactamente el dato falso que el módulo vino a sacar: quien mira la planilla
   * no distingue "no produjo" de "no se sabe".
   *
   * Ojo con la diferencia: esto es para el producto **ausente** del mapa. Un
   * cero explícito se escribe cero siempre, porque es una medición.
   */
  siFalta?: "cero" | "vacio";
}

export function celdasDeResumen(
  encabezados: readonly string[],
  productos: readonly Producto[],
  valores: Readonly<Record<string, number | string>>,
  opciones: OpcionesDeResumen = {}
): FilaDeResumen {
  const desde = opciones.desde ?? 1;
  const hasta = opciones.hasta ?? encabezados.length;
  const siFalta = opciones.siFalta ?? "cero";

  const celdas: CeldaDeResumen[] = [];
  const sinColumna: string[] = [];

  for (const p of productos) {
    // Null es una decisión: este producto no se exporta. No es un faltante.
    if (!p.nombre_planilla) continue;

    let columna = -1;
    for (let i = desde; i < hasta; i++) {
      if (String(encabezados[i] ?? "").trim() === p.nombre_planilla.trim()) {
        columna = i;
        break;
      }
    }

    if (columna === -1) {
      sinColumna.push(p.nombre_planilla);
      continue;
    }

    const v = valores[p.id];
    celdas.push({
      columna,
      valor: v === undefined ? (siFalta === "vacio" ? "" : "0") : String(v),
    });
  }

  return { celdas, sinColumna };
}

/**
 * El % de rotura de un producto.
 *
 * Hoy el Apps Script devuelve 0 cuando la producción es 0, y un 0 en esa celda
 * dice "no hubo roturas" cuando sí las hubo. Vacío dice lo que realmente pasa:
 * no hay porcentaje posible. Las unidades rotas están en el bloque de al lado.
 *
 * Se escribe la división sin redondear. `escribirCeldas` manda las celdas con
 * `valueInputOption=USER_ENTERED` (`lib/core/sheets.ts`), que es como si
 * alguien tipeara el valor: Sheets lo guarda como número y lo muestra con el
 * formato de porcentaje que ya tiene la celda, no con los dígitos de más que
 * trae el string. Redondear acá sería tirar precisión que la planilla ya
 * recorta sola al mostrarlo.
 */
export function porcentajeDeRotura(rotura: number, produccion: number): string {
  if (produccion > 0) return String(rotura / produccion);
  return rotura === 0 ? "0" : "";
}
