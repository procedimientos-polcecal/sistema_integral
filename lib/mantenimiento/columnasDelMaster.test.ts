/**
 * Que ninguna columna del master quede sin clasificar.
 *
 * El aviso de la pantalla de OT —«esto no se puede corregir en la planilla»—
 * se arma con estas listas. Si alguien agrega una columna al mapa y no la pone
 * en ninguno de los tres grupos, la pantalla seguiría funcionando y diría algo
 * incompleto, que es la peor forma de equivocarse: un aviso que omite
 * justamente el campo que alguien está por corregir a mano.
 */
import { describe, it, expect } from "vitest";
import {
  COLUMNAS_DE_DERRAME, COLUMNAS_ESCRIBIBLES, COLUMNA_CALCULADA,
  TODAS_LAS_COLUMNAS, LO_QUE_NO_SE_CORRIGE_EN_EL_MASTER,
} from "./ordenes";

describe("las columnas del master", () => {
  it("cada una está en exactamente un grupo", () => {
    const sinClasificar: number[] = [];
    const repetidas: number[] = [];

    for (const col of TODAS_LAS_COLUMNAS) {
      const veces =
        (COLUMNAS_DE_DERRAME.includes(col) ? 1 : 0) +
        (COLUMNAS_ESCRIBIBLES.includes(col) ? 1 : 0) +
        (col === COLUMNA_CALCULADA ? 1 : 0);
      if (veces === 0) sinClasificar.push(col);
      if (veces > 1) repetidas.push(col);
    }

    expect({ sinClasificar, repetidas }).toEqual({ sinClasificar: [], repetidas: [] });
  });

  /**
   * Las A a la J son contiguas y la S es la prioridad: es el reparto que dejó
   * medido `docs/VARIABLES-VERCEL.md` y el que se comprobó contra la planilla
   * el 26/10/2026. Fijarlo acá hace que moverlo sea una decisión y no un
   * descuido.
   */
  it("el derrame es la A a la J más la S", () => {
    expect([...COLUMNAS_DE_DERRAME].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 18]);
  });

  it("la calculada no se puede escribir ni es derrame", () => {
    expect(COLUMNAS_ESCRIBIBLES).not.toContain(COLUMNA_CALCULADA);
    expect(COLUMNAS_DE_DERRAME).not.toContain(COLUMNA_CALCULADA);
  });

  /**
   * Una etiqueta por columna de derrame menos el N° de OT, que no se nombra a
   * propósito. Sin esto, agregar una columna al derrame dejaría el aviso de la
   * pantalla nombrando una menos.
   */
  it("hay un nombre para cada campo de derrame que alguien podría corregir", () => {
    expect(LO_QUE_NO_SE_CORRIGE_EN_EL_MASTER).toHaveLength(COLUMNAS_DE_DERRAME.length - 1);
  });
});
