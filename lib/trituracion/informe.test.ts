import { describe, expect, it } from "vitest";
import { resumenMensual, ultimosMeses } from "./informe";

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
