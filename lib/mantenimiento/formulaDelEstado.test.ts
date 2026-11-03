import { describe, it, expect } from "vitest";
import { lasQueLesFaltaLaFormula, FRENO_DE_FORMULAS } from "./formulaDelEstado";

/** A = N° OT, M = ESTADO. Lo del medio no importa para esto. */
const ENC = ["N° OT", "FECHA", "ESTADO"];
const COL_OT = 0;
const COL_ESTADO = 2;

/** `filas` son los valores; `formulas[i][0]` dice si la M de esa fila es fórmula. */
const pedir = (filas: unknown[][], formulas: boolean[]) =>
  lasQueLesFaltaLaFormula(filas, formulas.map((f) => [f]), COL_OT, COL_ESTADO);

describe("a qué celdas del ESTADO les falta la fórmula", () => {
  it("una celda vacía y sin fórmula entra", () => {
    const r = pedir([ENC, [2949, "31/10", ""]], [false, false]);
    expect(r.celdas).toEqual([
      { ot_number: 2949, fila: 2, columna: COL_ESTADO, valor: '=IF(J2="","",L2)' },
    ]);
    expect(r.freno).toBeNull();
  });

  it("una con texto no se toca: alguien lo escribió", () => {
    expect(pedir([ENC, [2949, "31/10", "Realizado"]], [false, false]).celdas).toEqual([]);
  });

  /**
   * La que hace que esto sea idempotente. Una celda que YA tiene la fórmula se
   * ve vacía cuando esa OT no tiene fecha de ejecución —es el caso de la 622—,
   * y mirando sólo el texto se la propondría en cada corrida, para siempre.
   */
  it("una vacía que ya tiene la fórmula no se vuelve a escribir", () => {
    expect(pedir([ENC, [622, "", ""]], [false, true]).celdas).toEqual([]);
  });

  it("una fila que no es una OT se saltea", () => {
    expect(pedir([ENC, ["", "", ""], ["total", "", ""]], [false, false, false]).celdas).toEqual([]);
  });

  it("la fórmula nombra su propia fila, no una fija", () => {
    const r = pedir([ENC, [1, "", "x"], [2, "", "x"], [2949, "31/10", ""]], [false, false, false, false]);
    expect(r.celdas[0].valor).toBe('=IF(J4="","",L4)');
    expect(r.celdas[0].fila).toBe(4);
  });

  /**
   * El freno, y es el mismo que el de `borradoDeEspejo` por la misma razón:
   * una planilla recalculando devuelve **vacías** las celdas que no resolvió, y
   * «vacío» es justo el criterio de esto. Sin freno, una corrida en mal momento
   * escribiría la fórmula sobre dos mil estados cargados a mano.
   */
  it("si habría que escribir demasiadas, no escribe ninguna", () => {
    const filas: unknown[][] = [ENC];
    const formulas = [false];
    for (let i = 0; i < FRENO_DE_FORMULAS + 1; i++) {
      filas.push([1000 + i, "", ""]);
      formulas.push(false);
    }
    const r = pedir(filas, formulas);
    expect(r.celdas).toEqual([]);
    expect(r.freno).toContain(String(FRENO_DE_FORMULAS));
  });

  it("justo en el tope todavía escribe", () => {
    const filas: unknown[][] = [ENC];
    const formulas = [false];
    for (let i = 0; i < FRENO_DE_FORMULAS; i++) {
      filas.push([1000 + i, "", ""]);
      formulas.push(false);
    }
    const r = pedir(filas, formulas);
    expect(r.celdas).toHaveLength(FRENO_DE_FORMULAS);
    expect(r.freno).toBeNull();
  });
});
