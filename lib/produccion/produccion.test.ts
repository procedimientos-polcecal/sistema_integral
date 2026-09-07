import { describe, it, expect } from "vitest";
import { produccionDelTurno, produccionDelDia, soloLoCalculado } from "./produccion";

/** Bolsones de Calcio 0-1, 03/09/2026, tal como está en el Excel relevado. */
const calcio01 = "p-calcio-0-1";

describe("la produccion de un turno", () => {
  it("es deposito - deposito anterior + despachado + rotura", () => {
    const r = produccionDelTurno({
      deposito: { [calcio01]: 29 },
      depositoAnterior: { [calcio01]: 17 },
      despachado: { [calcio01]: 0 },
      rotura: { [calcio01]: 0 },
    });
    expect(r[calcio01]).toEqual({ estado: "calculada", cantidad: 12 });
  });

  it("el turno siguiente arranca del deposito del anterior", () => {
    const r = produccionDelTurno({
      deposito: { [calcio01]: 17 },
      depositoAnterior: { [calcio01]: 29 },
      despachado: { [calcio01]: 13 },
      rotura: { [calcio01]: 0 },
    });
    expect(r[calcio01]).toEqual({ estado: "calculada", cantidad: 1 });
  });

  /**
   * La razón de ser del módulo. Un cero no se distingue de un día sin producir,
   * y así es como se pierde media semana sin que nada avise.
   */
  it("sin parte anterior no calcula, y lo dice", () => {
    const r = produccionDelTurno({
      deposito: { [calcio01]: 29 },
      depositoAnterior: null,
      despachado: { [calcio01]: 0 },
      rotura: { [calcio01]: 0 },
    });
    expect(r[calcio01]).toEqual({ estado: "sin_parte_anterior" });
  });

  /** Una producción negativa es un error de carga y hay que verlo, no taparlo. */
  it("una produccion negativa se devuelve negativa", () => {
    const r = produccionDelTurno({
      deposito: { [calcio01]: 0 },
      depositoAnterior: { [calcio01]: 10 },
      despachado: {},
      rotura: {},
    });
    expect(r[calcio01]).toEqual({ estado: "calculada", cantidad: -10 });
  });

  it("un producto que solo aparece en el despacho igual se calcula", () => {
    const r = produccionDelTurno({
      deposito: {},
      depositoAnterior: {},
      despachado: { [calcio01]: 13 },
      rotura: {},
    });
    expect(r[calcio01]).toEqual({ estado: "calculada", cantidad: 13 });
  });

  it("un producto que no aparece en ningun lado no aparece en el resultado", () => {
    const r = produccionDelTurno({
      deposito: {}, depositoAnterior: {}, despachado: {}, rotura: {},
    });
    expect(Object.keys(r)).toEqual([]);
  });
});

describe("la produccion del dia", () => {
  it("suma los dos turnos", () => {
    const t1 = produccionDelTurno({
      deposito: { [calcio01]: 29 },
      depositoAnterior: { [calcio01]: 17 },
      despachado: {}, rotura: {},
    });
    const t2 = produccionDelTurno({
      deposito: { [calcio01]: 17 },
      depositoAnterior: { [calcio01]: 29 },
      despachado: { [calcio01]: 13 }, rotura: {},
    });
    expect(produccionDelDia([t1, t2])[calcio01]).toEqual({ estado: "calculada", cantidad: 13 });
  });

  /** Si un turno no se puede calcular, el día tampoco. Medio día no es un día. */
  it("si un turno no se puede calcular, el dia tampoco", () => {
    const t1 = produccionDelTurno({
      deposito: { [calcio01]: 29 }, depositoAnterior: null, despachado: {}, rotura: {},
    });
    const t2 = produccionDelTurno({
      deposito: { [calcio01]: 17 },
      depositoAnterior: { [calcio01]: 29 },
      despachado: { [calcio01]: 13 }, rotura: {},
    });
    expect(produccionDelDia([t1, t2])[calcio01]).toEqual({ estado: "sin_parte_anterior" });
  });

  /**
   * El mismo caso anterior pero con el turno malo al revés. El plan sólo
   * probaba el orden turno-malo-primero; hay que probar los dos porque
   * `produccionDelDia` acumula turno por turno y un cambio en el orden de
   * evaluación de la condición podría arreglar uno y romper el otro en
   * silencio.
   */
  it("si el turno que falta es el segundo, el dia tampoco se puede", () => {
    const t1 = produccionDelTurno({
      deposito: { [calcio01]: 29 },
      depositoAnterior: { [calcio01]: 17 },
      despachado: {}, rotura: {},
    });
    const t2 = produccionDelTurno({
      deposito: { [calcio01]: 17 }, depositoAnterior: null, despachado: {}, rotura: {},
    });
    expect(produccionDelDia([t1, t2])[calcio01]).toEqual({ estado: "sin_parte_anterior" });
  });

  it("sin turnos cargados el dia no tiene productos", () => {
    expect(produccionDelDia([])).toEqual({});
  });
});

describe("solo lo calculado, para exportar a la planilla", () => {
  it("un producto calculado pasa", () => {
    const dia = produccionDelTurno({
      deposito: { [calcio01]: 29 },
      depositoAnterior: { [calcio01]: 17 },
      despachado: {}, rotura: {},
    });
    expect(soloLoCalculado(dia)).toEqual({ [calcio01]: 12 });
  });

  it("un producto sin parte anterior no aparece", () => {
    const dia = produccionDelTurno({
      deposito: { [calcio01]: 29 }, depositoAnterior: null, despachado: {}, rotura: {},
    });
    expect(soloLoCalculado(dia)).toEqual({});
  });

  /** Es un dato real, aunque sea un error de carga: no se filtra por su signo. */
  it("un producto calculado negativo si pasa", () => {
    const dia = produccionDelTurno({
      deposito: { [calcio01]: 0 },
      depositoAnterior: { [calcio01]: 10 },
      despachado: {}, rotura: {},
    });
    expect(soloLoCalculado(dia)).toEqual({ [calcio01]: -10 });
  });
});
