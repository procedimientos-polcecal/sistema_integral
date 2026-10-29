import { describe, expect, it } from "vitest";
import { leerFiller1, leerFiller2 } from "./csv";

describe("leerFiller1", () => {
  it("arma una fila por renglon y le pone el turno segun la hora de cierre", () => {
    const dat1 = "26/2/2026;19:59;0;0;0;51530;451;min;MEMBRANERO;AUTOMATICO";
    const { filas } = leerFiller1(dat1, {});
    expect(filas).toEqual([{
      fecha: "2026-02-26", corte: "19:59", kg: 51530, minutos: 451, porMaterial: {},
    }]);
  });

  it("toma el reparto por material del archivo del corte, no de la etiqueta", () => {
    // 1/3/2026 3:59 son 17.682 de membranero + 15.961 de dolomita, y DAT1 dice DOLOMITA
    const dat1 = "1/3/2026;3:59;0;33643;0;0;232;min;DOLOMITA;AUTOMATICO";
    const dat3 = "1/3/2026;3:59;17682;15961;0";
    const { filas } = leerFiller1(dat1, { "3:59": dat3 });
    expect(filas[0].porMaterial).toEqual({ membranero: 17682, dolomita: 15961, caliza: 0 });
    expect(filas[0].kg).toBe(33643);
  });

  it("ignora las lineas en blanco", () => {
    const { filas } = leerFiller1("\n\n26/2/2026;19:59;0;0;0;51530;451;min;MEMBRANERO;X\n\n", {});
    expect(filas).toHaveLength(1);
  });

  it("avisa de una hora que no es uno de los cuatro cortes, y no la incluye", () => {
    const { filas, avisos } = leerFiller1("26/2/2026;7:30;0;0;0;100;60;min;CALIZA;X", {});
    expect(filas).toHaveLength(0);
    expect(avisos[0]).toContain("7:30");
  });

  it("no cruza el reparto de otro dia ni de otro corte", () => {
    const dat1 = "2/3/2026;3:59;0;0;0;100;60;min;CALIZA;X";
    const { filas } = leerFiller1(dat1, { "3:59": "1/3/2026;3:59;1;2;3", "11:59": "2/3/2026;11:59;4;5;6" });
    expect(filas[0].porMaterial).toEqual({});
  });

  it("tolera el fin de linea de Windows", () => {
    const { filas, avisos } = leerFiller1("26/2/2026;19:59;0;0;0;51530;451;min;M;X\r\n", {});
    expect(filas).toHaveLength(1);
    expect(avisos).toEqual([]);
  });

  it("avisa de un renglon incompleto y no lo completa con ceros", () => {
    const { filas, avisos } = leerFiller1("26/2/2026;19:59;0;0", {});
    expect(filas).toHaveLength(0);
    expect(avisos).toHaveLength(1);
  });

  it("avisa de una fecha que no existe", () => {
    const { filas, avisos } = leerFiller1("31/2/2026;19:59;0;0;0;100;60;min;M;X", {});
    expect(filas).toHaveLength(0);
    expect(avisos[0]).toContain("31/2/2026");
  });
});

describe("leerFiller2", () => {
  it("suma los seis pares kg y minutos", () => {
    const { filas } = leerFiller2({ "19:59": "12/2/2026;19:59;23285;290;0;0;0;0;0;0;0;0;0;0" });
    expect(filas[0]).toMatchObject({ fecha: "2026-02-12", corte: "19:59", kg: 23285, minutos: 290 });
  });

  it("guarda el reparto por los seis materiales", () => {
    const { filas } = leerFiller2({ "3:59": "13/2/2026;3:59;0;0;1000;20;0;0;0;0;0;0;500;10" });
    expect(filas[0].porMaterial).toMatchObject({ piedra_dolomita: 1000, arena_caliza: 500 });
  });

  it("suma kilos y minutos de varios materiales y junta los archivos de los cuatro cortes", () => {
    const { filas } = leerFiller2({
      "3:59": "13/2/2026;3:59;100;10;200;20;0;0;0;0;0;0;300;30",
      "23:59": "13/2/2026;23:59;1;1;0;0;0;0;0;0;0;0;0;0",
    });
    expect(filas).toHaveLength(2);
    expect(filas[0]).toMatchObject({ kg: 600, minutos: 60 });
    expect(filas[1].corte).toBe("23:59");
  });

  it("ignora las lineas en blanco", () => {
    const { filas } = leerFiller2({ "3:59": "\n\n13/2/2026;3:59;0;0;0;0;0;0;0;0;0;0;0;0\n\n\n" });
    expect(filas).toHaveLength(1);
  });
});
