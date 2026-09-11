import { describe, it, expect } from "vitest";
import { armarInformeMensual, type VoladuraParaInforme, type BochonParaInforme } from "./informe";

function voladura(v: Partial<VoladuraParaInforme> & { codigo: string; cantera: string }): VoladuraParaInforme {
  return {
    perfFin: null,
    perfMetros: null,
    perfMontoUsd: null,
    perfMontoArs: null,
    volFecha: null,
    volTc: null,
    toneladas: null,
    consumos: [],
    ...v,
  };
}

describe("armarInformeMensual", () => {
  it("separa perforaciones (por fin de perf.) y voladuras (por fecha de voladura) del mes", () => {
    const voladuras = [
      // perforada en agosto, volada en septiembre: entra en perforaciones de agosto, no en voladuras
      voladura({ codigo: "V01D626", cantera: "D6", perfFin: "2026-08-28", perfMetros: 100, perfMontoUsd: 1343, perfMontoArs: 2000000, volFecha: "2026-09-02", toneladas: 500 }),
      // perforada y volada en agosto
      voladura({ codigo: "V02D626", cantera: "D6", perfFin: "2026-08-05", perfMetros: 50, perfMontoUsd: 671.5, perfMontoArs: 1000000, volFecha: "2026-08-10", toneladas: 300, consumos: [{ tipo: "detonador", cantidad: 100, precio_usd: 4 }] }),
    ];
    const informe = armarInformeMensual("2026-08", voladuras, []);

    expect(informe.perforaciones.map((p) => p.codigo)).toEqual(["V01D626", "V02D626"]);
    expect(informe.voladuras.map((v) => v.codigo)).toEqual(["V02D626"]);
    expect(informe.totales.metrosPerforados).toBe(150);
    expect(informe.totales.toneladas).toBe(300);
  });

  it("el monto de voladura sale de los consumos con el 4% de servicio", () => {
    const voladuras = [
      voladura({
        codigo: "V01D626", cantera: "D6", volFecha: "2026-08-10", volTc: 1400, toneladas: 300,
        consumos: [{ tipo: "detonador", cantidad: 100, precio_usd: 4 }],
      }),
    ];
    const informe = armarInformeMensual("2026-08", voladuras, []);
    expect(informe.voladuras[0].montoUsd).toBeCloseTo(400 * 1.04, 2);
    expect(informe.voladuras[0].montoArs).toBeCloseTo(400 * 1.04 * 1400, 0);
  });

  it("agrupa por cantera: USD/ton, ton/m perforado y el desglose de insumos", () => {
    const voladuras = [
      voladura({ codigo: "V01D626", cantera: "D6", perfFin: "2026-08-05", perfMetros: 100, perfMontoUsd: 1000 }),
      voladura({
        codigo: "V02D626", cantera: "D6", volFecha: "2026-08-10", volTc: 1000, toneladas: 400,
        consumos: [
          { tipo: "detonador", cantidad: 100, precio_usd: 2 },
          { tipo: "otros_insumos", cantidad: 10, precio_usd: 5 },
        ],
      }),
    ];
    const informe = armarInformeMensual("2026-08", voladuras, []);
    const d6 = informe.porCantera.find((c) => c.cantera === "D6")!;

    // base = 200 + 50 = 250; voladuraUsd = 250 × 1,04 = 260
    expect(d6.voladuraUsd).toBeCloseTo(260, 2);
    expect(d6.perforacionUsd).toBe(1000);
    expect(d6.usdPorTon).toBeCloseTo((1000 + 260) / 400, 4);
    expect(d6.tonPorMetroPerforado).toBeCloseTo(400 / 100, 4);
    expect(d6.detonadorUsd).toBe(200);
    expect(d6.otrosInsumosUsd).toBe(50);
    expect(d6.servicioUsd).toBeCloseTo(10, 2); // 4% de 250
  });

  it("bochones del mes se filtran por su fecha y no afectan a las otras dos listas", () => {
    const bochones: BochonParaInforme[] = [
      { codigo: "B01D626", cantera: "D6", fecha: "2026-08-15", metros: 197, montoUsd: 998.79, montoArs: 1513166.85 },
      { codigo: "B02D626", cantera: "D6", fecha: "2026-07-15", metros: 100, montoUsd: 507, montoArs: 700000 },
    ];
    const informe = armarInformeMensual("2026-08", [], bochones);
    expect(informe.bochones.map((b) => b.codigo)).toEqual(["B01D626"]);
    expect(informe.totales.bochonUsd).toBeCloseTo(998.79, 2);
  });

  it("un mes sin nada da totales en cero, no rompe", () => {
    const informe = armarInformeMensual("2026-12", [], []);
    expect(informe.totales.toneladas).toBe(0);
    expect(informe.porCantera).toEqual([]);
  });
});
