/**
 * ¿Esta pestaña se cayó, o sólo tiene celdas feas?
 *
 * Las planillas del sistema son cadenas de fórmulas: una pestaña nace de un
 * `QUERY(IMPORTRANGE())` y otras diez son `FILTER` de ésa. Cuando la de arriba
 * deja de resolver, **todas** se vacían a la vez y nada avisa: el espejo sigue
 * sincronizando, sólo que contra una planilla que ya no dice nada.
 *
 * Eso pasó dos veces en una semana:
 *
 *   * **13/10/2026** — la planilla de OT estaba recalculando. Devolvió dos
 *     filas de 623 y un `Cargando…`, y una OT nueva fue a parar encima de otra.
 *   * **19/10/2026** — 1.686 celdas de `APROB COMPRAS` importaban el propio
 *     libro, el `IMPORTRANGE` que alimenta al master no resolvió nunca y las
 *     once pestañas de Compras quedaron vacías el día entero.
 *
 * ── POR QUÉ NO ALCANZA CON "¿HAY CELDAS EN ERROR?"
 *
 * Porque hay miles y son normales. Medido el 19/10/2026 sobre las once
 * planillas configuradas: 2.420 `#N/A` en `APROB COMPRAS`, 1.659 en el
 * seguimiento, 972 en `COMPRAS PRODUCCIÓN`. Casi todos son un `VLOOKUP` sobre
 * una fila vacía o una clave que no está —que es la respuesta correcta de un
 * `VLOOKUP`— y llevan meses ahí.
 *
 * Un informe que los cuenta a todos sale rojo siempre, y uno que sale rojo
 * siempre no lo mira nadie. Es la misma razón por la que el lint todavía no
 * está en el CI.
 *
 * ── LO QUE SÍ DISTINGUE UNA CAÍDA
 *
 * **Que la pestaña se haya quedado sin filas.** Un `#N/A` en la fila 351 de 600
 * es una clave que no se encontró; el mismo `#N/A` cuando la pestaña tiene UNA
 * fila es la fórmula madre que no produjo nada, y abajo no hay nada más.
 *
 * Por eso hacen falta las dos condiciones juntas: una fórmula **de las que
 * generan una región** —`QUERY`, `FILTER`, `IMPORTRANGE`, `ARRAYFORMULA`— que
 * devuelve error, **y** una pestaña vacía. Con el corte en celdas sueltas, las
 * once planillas daban 16 alertas de las cuales 15 eran ruido de años; con
 * éste, las dos caídas reales se detectan y el ruido no aparece.
 *
 * El `VLOOKUP` queda afuera a propósito: genera **una** celda, así que uno roto
 * nunca es una caída.
 */

/** Los valores que Google deja en una celda que no pudo resolver. */
const ERRORES = new Set([
  "#REF!", "#N/A", "#VALUE!", "#NAME?", "#DIV/0!", "#ERROR!", "#NULL!", "#NUM!",
]);

export const esCeldaEnError = (valor: unknown): boolean =>
  ERRORES.has(String(valor ?? "").trim());

/**
 * Las funciones que producen **una región** y no una celda.
 *
 * Es la lista que importa: si una de éstas falla, se lleva puesto todo lo que
 * colgaba de ella. `VLOOKUP`, `IF`, `SUM` y compañía generan una celda sola y
 * no pueden vaciar una pestaña, así que no están.
 */
const GENERAN_REGION = ["QUERY", "FILTER", "IMPORTRANGE", "ARRAYFORMULA", "FLATTEN", "SORT"];

export const generaUnaRegion = (formula: unknown): boolean => {
  const t = String(formula ?? "");
  return t.startsWith("=") && GENERAN_REGION.some((f) => t.toUpperCase().includes(f));
};

/**
 * Cuántas filas de ésta tienen algo que no sea un error.
 *
 * La de encabezados no cuenta: sobrevive a cualquier caída porque está escrita
 * a mano, y contarla haría que una pestaña vacía pareciera tener una fila.
 */
export function filasConDatos(valores: readonly (readonly unknown[])[]): number {
  let n = 0;
  for (let i = 1; i < valores.length; i++) {
    const fila = valores[i] ?? [];
    if (fila.some((c) => String(c ?? "").trim() !== "" && !esCeldaEnError(c))) n++;
  }
  return n;
}

/**
 * Cuántas filas puede tener una pestaña caída.
 *
 * Dos y no cero, porque una caída deja restos: el 13/10 la planilla de OT
 * devolvió dos filas de 623, y el 19/10 el master devolvió una con `#VALUE!`.
 * Exigir cero las habría dejado pasar a las dos.
 *
 * El precio de este número es que una pestaña legítimamente diminuta sólo se
 * revisa si **además** su fórmula madre está en error — `RI INVERSIONES` tiene
 * dos requerimientos en total y no se la puede distinguir de una vacía por el
 * tamaño. Por eso las dos condiciones van juntas y nunca por separado.
 */
const VACIA_HASTA = 2;

export interface Sintoma {
  nivel: "ROMPE" | "MIRAR";
  que: string;
  donde: string;
}

/** Dónde está una celda, en la notación de la planilla. */
export function celda(fila: number, columna: number): string {
  const letra =
    columna < 26
      ? String.fromCharCode(65 + columna)
      : String.fromCharCode(64 + Math.floor(columna / 26)) + String.fromCharCode(65 + (columna % 26));
  return `${letra}${fila + 1}`;
}

/** Lo que Google deja en una celda cuyo valor todavía se está calculando. */
const CALCULANDO = /^(cargando|loading)\.\.\.$/i;

/**
 * El diagnóstico de una pestaña.
 *
 * `valores` y `formulas` son la misma región leída dos veces: una con el valor
 * que se ve y otra con `valueRenderOption=FORMULA`. Hace falta leerla dos veces
 * porque Google nunca devuelve las dos cosas juntas, y las dos hacen falta: el
 * valor dice que está rota y la fórmula dice si eso se lleva puesta la pestaña.
 *
 * `idPropio` es el id del libro al que pertenece la pestaña, para detectar el
 * que se importa a sí mismo.
 */
export function diagnosticarPestana(
  valores: readonly (readonly unknown[])[],
  formulas: readonly (readonly unknown[])[],
  idPropio: string
): Sintoma[] {
  const sintomas: Sintoma[] = [];
  const filas = filasConDatos(valores);

  // ── Está recalculando ──
  for (let i = 0; i < valores.length; i++) {
    const fila = valores[i] ?? [];
    for (let j = 0; j < fila.length; j++) {
      if (CALCULANDO.test(String(fila[j] ?? "").trim())) {
        sintomas.push({
          nivel: "ROMPE",
          que: 'está recalculando: devuelve "Cargando…" y columnas vacías',
          donde: celda(i, j),
        });
        i = valores.length;
        break;
      }
    }
  }

  // ── Se importa a sí misma, y fórmulas madre rotas ──
  const seImporta: string[] = [];
  const madresRotas: string[] = [];
  let sueltas = 0;

  for (let i = 0; i < formulas.length; i++) {
    const filaF = formulas[i] ?? [];
    const filaV = valores[i] ?? [];
    for (let j = 0; j < Math.max(filaF.length, filaV.length); j++) {
      const f = filaF[j];
      const v = filaV[j];

      if (String(f ?? "").includes("IMPORTRANGE") && String(f ?? "").includes(idPropio)) {
        seImporta.push(celda(i, j));
      }
      if (!esCeldaEnError(v)) continue;
      if (generaUnaRegion(f) && filas <= VACIA_HASTA) madresRotas.push(celda(i, j));
      else sueltas++;
    }
  }

  if (madresRotas.length) {
    sintomas.push({
      nivel: "ROMPE",
      que: `se vació: la fórmula que la genera devuelve error y quedaron ${filas} filas`,
      donde: madresRotas.slice(0, 4).join(", ") + (madresRotas.length > 4 ? ", …" : ""),
    });
  }
  if (seImporta.length) {
    sintomas.push({
      nivel: "MIRAR",
      que:
        `${seImporta.length} fórmula${seImporta.length > 1 ? "s" : ""} con IMPORTRANGE al PROPIO libro ` +
        `(una referencia local trae lo mismo sin salir a la red; si la pestaña que importa pasa a ` +
        `depender de otra fórmula, el lazo no resuelve nunca — es lo que tiró Compras el 19/10/2026)`,
      donde: seImporta.slice(0, 4).join(", ") + (seImporta.length > 4 ? ", …" : ""),
    });
  }
  if (sueltas) {
    sintomas.push({
      nivel: "MIRAR",
      que: `${sueltas} celdas sueltas en error (un VLOOKUP sin su clave, casi siempre)`,
      donde: "",
    });
  }

  return sintomas;
}
