import { describe, expect, it } from "vitest";
import { resumenMensual, toneladasPorMaterial, ultimosMeses } from "./informe";

describe("resumenMensual", () => {
  it("suma sólo los días operativos, y cuenta aparte los que no operaron", () => {
    const r = resumenMensual([
      {
        fecha: "2026-06-02", estado: "opero",
        horaInicio: "04:40", horaFin: "11:30",
        horasMantenimiento: 0, horasFaltaPiedra: 1.1666666666666667, horasProduccion: 0, horasOtro: 0,
        toneladasProcesadas: 542, camionesLlegados: 44,
      },
      {
        fecha: "2026-06-04", estado: "no_opero",
        horaInicio: null, horaFin: null,
        horasMantenimiento: 0, horasFaltaPiedra: 0, horasProduccion: 0, horasOtro: 0,
        toneladasProcesadas: null, camionesLlegados: null,
      },
    ]);

    expect(r.diasOperativos).toBe(1);
    expect(r.diasNoOperativos).toBe(1);
    expect(r.toneladasTotal).toBe(542);
    expect(r.disponibilidadPromedio).toBeCloseTo(0.8293, 3);
  });

  it("sin ningún día operativo, los promedios son null y no NaN", () => {
    const r = resumenMensual([
      {
        fecha: "2026-06-04", estado: "no_opero",
        horaInicio: null, horaFin: null,
        horasMantenimiento: 0, horasFaltaPiedra: 0, horasProduccion: 0, horasOtro: 0,
        toneladasProcesadas: null, camionesLlegados: null,
      },
    ]);
    expect(r.disponibilidadPromedio).toBeNull();
    expect(r.productividadRealPromedio).toBeNull();
    expect(r.toneladasTotal).toBe(0);
  });

  it("lista vacía no revienta y da todo en cero/null", () => {
    const r = resumenMensual([]);
    expect(r.diasOperativos).toBe(0);
    expect(r.disponibilidadPromedio).toBeNull();
  });
});

describe("ultimosMeses", () => {
  it("da los últimos N meses en orden, cruzando el año", () => {
    expect(ultimosMeses("2026-01", 3)).toEqual(["2025-11", "2025-12", "2026-01"]);
  });
});

describe("toneladasPorMaterial", () => {
  it("suma sólo días operativos, ordenado de mayor a menor", () => {
    const r = toneladasPorMaterial([
      { estado: "opero", material: "Dolomita", toneladasProcesadas: 300 },
      { estado: "opero", material: "Dolomita", toneladasProcesadas: 200 },
      { estado: "opero", material: "Chocolata", toneladasProcesadas: 100 },
      { estado: "no_opero", material: null, toneladasProcesadas: null },
    ]);
    expect(r).toEqual([
      { material: "Dolomita", toneladas: 500 },
      { material: "Chocolata", toneladas: 100 },
    ]);
  });

  it("agrupa un material combinado por la importación aparte, como 'Sin clasificar'", () => {
    const r = toneladasPorMaterial([
      { estado: "opero", material: "Caliza + Chocolata", toneladasProcesadas: 1120 },
    ]);
    expect(r).toEqual([{ material: "Sin clasificar", toneladas: 1120 }]);
  });

  it("lista vacía da lista vacía", () => {
    expect(toneladasPorMaterial([])).toEqual([]);
  });
});
