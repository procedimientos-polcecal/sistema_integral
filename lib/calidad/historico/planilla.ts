/**
 * Leer `Determinaciones 2026.xlsx`, las nueve hojas, sin tocar ningún número.
 *
 * El libro tiene **tres formas distintas** y las tres terminan en la misma fila
 * larga `(fecha, origen, determinación, valor)`:
 *
 * - **Tabular, una fila por día** — `Filler 1`, `Cal`, `Filler 2`, `Despacho a
 *   Kartonsec`, `Despacho a Emapi`. El origen es la hoja.
 * - **Tabular pero no es un ensayo** — `Despachos cal fillerizada`: el origen es
 *   el cliente de cada fila.
 * - **Bloques sueltos** — `Calcio`, `Otros`, `Separadoras`: la fecha arriba, los
 *   nombres de muestra de costado, y debajo una fila por determinación.
 *
 * Sin IO: recibe celdas ya leídas. Es lo que permite probarlo.
 */

import { escalaDeLaColumna, escalaDelValor } from "./escala";
import type { Celda, FilaHistorica } from "./types";

/** La hoja cuyo origen es el cliente de cada fila y no la pestaña. */
const HOJA_POR_CLIENTE = "Despachos cal fillerizada";

/** Cuánto puede separarse un acumulado de la suma de sus retenidos. */
const TOLERANCIA = 0.15;

const texto = (c: Celda | undefined): string => String(c?.valor ?? "").trim();
const numero = (c: Celda | undefined): number | null => {
  const v = c?.valor;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};
const esFecha = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s);

/**
 * Si la celda es un agregado y no una medición.
 *
 * **Por la fórmula y nunca por el valor**: el resultado de un `AVERAGE` es un
 * número igual a cualquier otro. El libro tiene 22, todas en `Calcio`, metidas
 * entre las muestras; guardarlas haría que alguien le conteste a un cliente con
 * un promedio creyendo que es un ensayo.
 */
export function esAgregacion(celda: Celda): boolean {
  return /\b(AVERAGE|PROMEDIO|SUM|SUMA)\s*\(/i.test(celda.formula ?? "");
}

/** La malla que nombra la etiqueta, o `null` si no nombra ninguna. */
export function mallaDeLaEtiqueta(etiqueta: string): number | null {
  const m = etiqueta.match(/#\s*(\d+)/);
  return m ? Number(m[1]) : null;
}

/** La unidad entre paréntesis al final de la etiqueta. */
export function unidadDeLaEtiqueta(etiqueta: string): string | null {
  const m = etiqueta.match(/\(([^()]+)\)\s*$/);
  return m ? m[1].trim() : null;
}

/** Los valores anteriores al corte de cada columna, para decidir su escala. */
function escalasDeLasColumnas(encabezado: string[], filas: Celda[][]): Map<number, ReturnType<typeof escalaDeLaColumna>> {
  const escalas = new Map<number, ReturnType<typeof escalaDeLaColumna>>();
  for (let i = 1; i < encabezado.length; i++) {
    const etiqueta = encabezado[i];
    if (!etiqueta) continue;
    const previos: number[] = [];
    for (const fila of filas) {
      const fecha = texto(fila[0]);
      if (!esFecha(fecha) || fecha >= "2026-06-02") continue;
      const v = numero(fila[i]);
      if (v !== null && v !== 0) previos.push(v);
    }
    escalas.set(i, escalaDeLaColumna(etiqueta, previos));
  }
  return escalas;
}

/**
 * Las filas de una hoja tabular.
 *
 * `filas` llega en orden, con el índice 0 correspondiendo a la fila 2 de la
 * planilla — la 1 es el encabezado.
 */
export function filasDeHojaTabular(
  hoja: string,
  encabezado: string[],
  filas: Celda[][]
): FilaHistorica[] {
  const escalas = escalasDeLasColumnas(encabezado, filas);
  const porCliente = hoja === HOJA_POR_CLIENTE;
  const iCliente = porCliente
    ? encabezado.findIndex((e) => /cliente/i.test(e ?? ""))
    : -1;

  const salida: FilaHistorica[] = [];

  filas.forEach((fila, indice) => {
    const fecha = texto(fila[0]);
    if (!esFecha(fecha)) return;

    // Sin origen no hay a qué colgar el valor. En la hoja por cliente eso
    // significa perder la fila: preferible a inventarle dueño a una tonelada.
    const origen = porCliente ? texto(fila[iCliente]) : hoja;
    if (!origen) return;

    for (let i = 1; i < encabezado.length; i++) {
      const etiqueta = encabezado[i];
      if (!etiqueta || i === iCliente) continue;
      const celda = fila[i];
      if (!celda || esAgregacion(celda)) continue;
      const valor = numero(celda);
      if (valor === null) continue;

      salida.push({
        fecha,
        hoja,
        origen_raw: origen,
        determinacion: etiqueta,
        malla: mallaDeLaEtiqueta(etiqueta),
        valor,
        escala: escalaDelValor(escalas.get(i) ?? "absoluto", fecha, etiqueta),
        unidad: unidadDeLaEtiqueta(etiqueta),
        revisar: null,
        fila_excel: indice + 2,
      });
    }
  });

  return salida;
}

/**
 * Las filas de una hoja en bloques.
 *
 * Un bloque empieza en una fila cuya primera celda es una fecha; las celdas a su
 * derecha son los nombres de muestra. Las filas siguientes son
 * `(determinación, valor por muestra)` hasta la próxima fila con fecha.
 *
 * Acá no hay encabezado del que sacar la escala, así que se decide por la
 * etiqueta sola: la humedad es fracción y lo demás, absoluto —son gramos—.
 */
export function filasDeHojaEnBloques(hoja: string, filas: Celda[][]): FilaHistorica[] {
  const salida: FilaHistorica[] = [];
  let fecha: string | null = null;
  let muestras: string[] = [];

  filas.forEach((fila, indice) => {
    const primera = texto(fila[0]);

    if (esFecha(primera)) {
      fecha = primera;
      muestras = fila.map((c) => texto(c));
      return;
    }

    if (!fecha || !primera) return;

    for (let i = 1; i < fila.length; i++) {
      const muestra = muestras[i];
      // Sin nombre de muestra no hay origen, y `origen_raw` no admite inventos.
      if (!muestra) continue;
      const celda = fila[i];
      if (!celda || esAgregacion(celda)) continue;
      const valor = numero(celda);
      if (valor === null) continue;

      salida.push({
        fecha,
        hoja,
        origen_raw: muestra,
        determinacion: primera,
        malla: mallaDeLaEtiqueta(primera),
        valor,
        escala: escalaDeLaColumna(primera, []) === "fraccion" ? "fraccion" : "absoluto",
        unidad: unidadDeLaEtiqueta(primera),
        revisar: null,
        fila_excel: indice + 1,
      });
    }
  });

  return salida;
}

/**
 * Qué decir de una fila cuyo acumulado no cierra contra sus retenidos.
 *
 * **Sólo corre cuando hay con qué comparar**: un acumulado y al menos dos
 * retenidos de mallas más gruesas. `Cal` tiene 204 filas con acumulado y ningún
 * retenido, y marcarlas todas serían 204 hallazgos falsos.
 *
 * No valida la escala —eso se creyó al principio y es falso, porque antes del
 * corte casi no había retenidos—. Sirve para lo que sí puede: señalar las filas
 * donde la planilla no cierra contra sí misma. Entran como están; corregirlas
 * sería interpretar.
 *
 * **Y sólo compara valores de la misma escala.** Entre febrero y mayo de 2026 el
 * `Ret #200` ya iba en porcentaje mientras el acumulado seguía en fracción:
 * comparar 0,113 contra 60 no es un hallazgo sobre la planilla, es que no son la
 * misma unidad. Sin este filtro aparecían 20 marcas falsas, todas en esa
 * ventana.
 */
export function revisarAritmetica(deLaFila: FilaHistorica[]): string | null {
  const retenidos = deLaFila.filter((f) => f.malla !== null && /^Ret/i.test(f.determinacion));
  const acumulados = deLaFila.filter((f) => f.malla !== null && /Acum/i.test(f.determinacion));

  for (const acum of acumulados) {
    const partes = retenidos.filter(
      (r) => r.malla! <= acum.malla! && r.escala === acum.escala
    );
    if (partes.length < 2) continue;

    const suma = partes.reduce((s, r) => s + r.valor, 0);
    if (Math.abs(suma - acum.valor) > TOLERANCIA) {
      return `el acumulado en #${acum.malla} dice ${acum.valor} y sus retenidos suman ${suma.toFixed(2)}`;
    }
  }

  return null;
}
