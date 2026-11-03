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

import { escalaDeLaEpoca, escalaDelValor, CORTE_DE_PLANILLA } from "./escala";
import type { Escala } from "./escala";
import type { Celda, FilaHistorica } from "./types";

/**
 * Cómo se llama la columna que dice de qué es la fila, en las hojas donde el
 * origen no es la pestaña.
 *
 * `Despachos cal fillerizada` lo pone en «Cliente» y `Calcio` en «Muestra». En
 * las otras cinco el origen es el nombre de la hoja.
 */
const COLUMNA_DE_ORIGEN = /^(cliente|muestra)$/i;

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

/** La escala de cada columna **en cada época**, decidida con sus propios datos. */
function escalasDeLasColumnas(
  encabezado: string[],
  filas: Celda[][]
): Map<number, { antes: Escala; desde: Escala }> {
  const escalas = new Map<number, { antes: Escala; desde: Escala }>();
  for (let i = 1; i < encabezado.length; i++) {
    const etiqueta = encabezado[i];
    if (!etiqueta) continue;
    const antes: number[] = [];
    const desde: number[] = [];
    for (const fila of filas) {
      const fecha = texto(fila[0]);
      if (!esFecha(fecha)) continue;
      const v = numero(fila[i]);
      if (v === null || v === 0) continue;
      (fecha < CORTE_DE_PLANILLA ? antes : desde).push(v);
    }
    escalas.set(i, {
      antes: escalaDeLaEpoca(etiqueta, antes),
      desde: escalaDeLaEpoca(etiqueta, desde),
    });
  }
  return escalas;
}

/**
 * Corrige la etiqueta de una columna ambigua preguntándole a la aritmética.
 *
 * La regla por columna no puede distinguir un 0,6% de una fracción de 0,6: las
 * dos se escriben igual. Pasa de verdad con el `Ret #50` de `Kartonsec` y de
 * `Emapi`, donde **todos** los valores son menores a 1 y aun así son
 * porcentajes —sus hermanos de la misma fila son 5,5 y 22,7—.
 *
 * Lo que sí puede decidirlo es la fila: el acumulado tiene que dar la suma de
 * sus retenidos. Se prueban las dos lecturas y gana la que hace cerrar más
 * filas. Si ninguna cierra más que la otra, no se toca nada: la aritmética no
 * siempre tiene algo que decir, y donde no lo tiene no se inventa.
 */
function desambiguarPorAritmetica(
  escalas: Map<number, { antes: Escala; desde: Escala }>,
  encabezado: string[],
  filas: Celda[][]
): Map<number, { antes: Escala; desde: Escala }> {
  const iAcum = encabezado.findIndex((e) => e && /Acum/i.test(e));
  if (iAcum < 0) return escalas;
  const mallaAcum = mallaDeLaEtiqueta(encabezado[iAcum]);
  if (mallaAcum === null) return escalas;

  const retenidos = encabezado
    .map((e, i) => ({ i, malla: e ? mallaDeLaEtiqueta(e) : null, esRet: Boolean(e && /^Ret/i.test(e)) }))
    .filter((c) => c.esRet && c.malla !== null && c.malla <= mallaAcum);

  for (const epoca of ["antes", "desde"] as const) {
    const enEsaEpoca = (f: string) =>
      epoca === "antes" ? f < CORTE_DE_PLANILLA : f >= CORTE_DE_PLANILLA;
    if (escalas.get(iAcum)?.[epoca] !== "porcentaje") continue;

    for (const col of retenidos) {
      const actual = escalas.get(col.i)?.[epoca];
      if (actual !== "fraccion") continue;

      let cierraComoEsta = 0;
      let cierraComoPorcentaje = 0;
      for (const fila of filas) {
        const fecha = texto(fila[0]);
        if (!esFecha(fecha) || !enEsaEpoca(fecha)) continue;
        const acum = numero(fila[iAcum]);
        const mio = numero(fila[col.i]);
        if (acum === null || mio === null) continue;
        const otros = retenidos
          .filter((r) => r.i !== col.i)
          .map((r) => numero(fila[r.i]))
          .filter((v): v is number => v !== null);
        if (otros.length === 0) continue;
        const suma = otros.reduce((a, b) => a + b, 0);
        if (Math.abs(suma + mio * 100 - acum) <= TOLERANCIA) cierraComoEsta++;
        if (Math.abs(suma + mio - acum) <= TOLERANCIA) cierraComoPorcentaje++;
      }

      if (cierraComoPorcentaje > cierraComoEsta) {
        escalas.set(col.i, { ...escalas.get(col.i)!, [epoca]: "porcentaje" });
      }
    }
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
  const escalas = desambiguarPorAritmetica(
    escalasDeLasColumnas(encabezado, filas),
    encabezado,
    filas
  );
  // La columna que dice de qué es la fila, si la hoja la tiene.
  const iOrigen = encabezado.findIndex((e) => COLUMNA_DE_ORIGEN.test((e ?? "").trim()));

  const salida: FilaHistorica[] = [];

  filas.forEach((fila, indice) => {
    const fecha = texto(fila[0]);
    if (!esFecha(fecha)) return;

    // Sin origen no hay a qué colgar el valor. En las hojas que lo traen por
    // fila eso significa perderla: preferible a inventarle dueño.
    const origen = iOrigen >= 0 ? texto(fila[iOrigen]) : hoja;
    if (!origen) return;

    for (let i = 1; i < encabezado.length; i++) {
      const etiqueta = encabezado[i];
      if (!etiqueta || i === iOrigen) continue;
      // Un encabezado que es una fecha no nombra una determinación: nombra
      // OTRA tabla, puesta al costado de ésta. `Calcio` tiene tres —columnas 10
      // a 18, una granulometría por fecha, con su propio encabezado dos filas
      // más abajo—, y leerlas como columnas metía 233 números de tamiz como si
      // fueran mediciones, cada uno con la fecha y la muestra de la fila de la
      // izquierda, que son de otro análisis. No se pierde nada que estuviera
      // bien: esas tablas no tienen forma de ninguna de las dos que se leen.
      if (esFecha(etiqueta.trim())) continue;
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
        escala: escalaDelValor(
          (fecha < CORTE_DE_PLANILLA ? escalas.get(i)?.antes : escalas.get(i)?.desde) ?? "absoluto",
          fecha,
          etiqueta
        ),
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
 * Un bloque empieza en una fila cuya primera celda es una fecha. Los nombres de
 * muestra son las celdas a su derecha —y **si la fecha va sola, los de la fila
 * siguiente**: en `Otros` pasa dos veces, y leerlo mal pierde 66 valores, entre
 * ellos la granulometría completa de seis productos—.
 *
 * **Una fecha nunca es un nombre de muestra.** `Separadoras` tiene una en un
 * casillero de nombre; sin esta guarda queda un origen llamado `2026-06-24` y,
 * debajo, un 50 de número de malla leído como humedad en fracción, que la
 * pantalla imprime como 5000%.
 *
 * Acá no hay encabezado del que sacar la escala, así que la decide la etiqueta
 * sola, con los mismos criterios que en una hoja tabular.
 */
export function filasDeHojaEnBloques(hoja: string, filas: Celda[][]): FilaHistorica[] {
  const salida: FilaHistorica[] = [];
  let fecha: string | null = null;
  let muestras: string[] = [];
  /** La fila que se consumió como encabezado del bloque, si hubo una. */
  let encabezadoEn = -1;

  /** Los nombres de una fila, sin las fechas, que no nombran a nadie. */
  const nombresDe = (fila: Celda[]): string[] =>
    fila.map((c) => {
      const t = texto(c);
      return esFecha(t) ? "" : t;
    });

  filas.forEach((fila, indice) => {
    const primera = texto(fila[0]);

    if (esFecha(primera)) {
      fecha = primera;
      muestras = nombresDe(fila);
      // La fecha puede venir sola y los nombres en la fila de abajo.
      encabezadoEn = -1;
      if (!muestras.slice(1).some(Boolean)) {
        const siguiente = filas[indice + 1];
        if (siguiente && !esFecha(texto(siguiente[0]))) {
          muestras = nombresDe(siguiente);
          encabezadoEn = indice + 1;
        }
      }
      return;
    }

    // La fila que se consumió como encabezado no vuelve a leerse.
    if (!fecha || !primera || indice === encabezadoEn) return;

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
        escala: escalaDelValor(escalaDeLaEpoca(primera, [valor]), fecha, primera),
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
