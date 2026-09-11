import { describe, it, expect } from "vitest";
import {
  armarInforme,
  armarInformeMensual,
  serieMensual,
  type VoladuraParaInforme,
  type BochonParaInforme,
} from "./informe";

function voladura(v: Partial<VoladuraParaInforme> & { codigo: string; cantera: string }): VoladuraParaInforme {
  return {
    perfFin: null,
    perfPozos: null,
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

  it("los gramos de detonador son la cantidad (en kilos) de los renglones tipo detonador, pasada a gramos", () => {
    const voladuras = [
      voladura({
        codigo: "V01D626", cantera: "D6", volFecha: "2026-08-10", volTc: 1000, toneladas: 200,
        consumos: [
          { tipo: "detonador", cantidad: 150, precio_usd: 4 },
          { tipo: "detonador", cantidad: 50, precio_usd: 3 },
          { tipo: "otros_insumos", cantidad: 999, precio_usd: 1 }, // no cuenta
        ],
      }),
    ];
    const informe = armarInformeMensual("2026-08", voladuras, []);
    // 150 + 50 = 200 kg × 1000 = 200.000 g
    expect(informe.voladuras[0].gramosDetonador).toBe(200000);
    expect(informe.totales.gramosDetonador).toBe(200000);
    const d6 = informe.porCantera.find((c) => c.cantera === "D6")!;
    expect(d6.gramosDetonador).toBe(200000);
    expect(d6.grExplosivoPorTon).toBe(1000); // 200.000 g / 200 t
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
    expect(d6.costoTotalUsd).toBeCloseTo(1260, 2); // perforación + voladura
  });

  it("la profundidad promedio es metros / pozos, y el detalle de consumos sintetiza el servicio", () => {
    const voladuras = [
      voladura({
        codigo: "V01D626", cantera: "D6", perfFin: "2026-08-05", perfPozos: 36, perfMetros: 108,
        volFecha: "2026-08-10", volTc: 1000,
        consumos: [{ tipo: "detonador", cantidad: 100, precio_usd: 4, insumo: "emulex" }],
      }),
    ];
    const informe = armarInformeMensual("2026-08", voladuras, []);
    expect(informe.perforaciones[0].profundidadProm).toBeCloseTo(3, 4);

    // dos renglones por voladura: el real y el servicio sintetizado
    expect(informe.consumosDetalle).toHaveLength(2);
    expect(informe.consumosDetalle[0]).toMatchObject({ codigo: "V01D626", insumo: "emulex", cantidad: 100 });
    const servicio = informe.consumosDetalle[1];
    expect(servicio.insumo).toBe("Servicio de voladura");
    expect(servicio.totalUsd).toBeCloseTo(400 * 0.04, 2);
    expect(servicio.totalArs).toBeCloseTo(400 * 0.04 * 1000, 0);
  });

  it("bochones del mes se filtran por su fecha y no afectan a las otras dos listas", () => {
    const bochones: BochonParaInforme[] = [
      { codigo: "B01D626", cantera: "D6", fecha: "2026-08-15", cantidad: 197, metros: 1, montoUsd: 998.79, montoArs: 1513166.85 },
      { codigo: "B02D626", cantera: "D6", fecha: "2026-07-15", cantidad: 100, metros: 1, montoUsd: 507, montoArs: 700000 },
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

describe("armarInforme (rango arbitrario)", () => {
  it("acepta cualquier desde/hasta, no sólo un mes de calendario", () => {
    const voladuras = [
      voladura({ codigo: "V01D626", cantera: "D6", volFecha: "2026-08-15", toneladas: 100 }),
      voladura({ codigo: "V02D626", cantera: "D6", volFecha: "2026-09-05", toneladas: 200 }),
      voladura({ codigo: "V03D626", cantera: "D6", volFecha: "2026-09-20", toneladas: 300 }),
    ];
    const informe = armarInforme("2026-08-20", "2026-09-10", voladuras, []);
    expect(informe.voladuras.map((v) => v.codigo)).toEqual(["V02D626"]);
  });
});

describe("serieMensual", () => {
  it("arma un punto por cada mes con actividad, ordenado cronológicamente", () => {
    const voladuras = [
      voladura({ codigo: "V01D626", cantera: "D6", volFecha: "2026-07-10", toneladas: 100, consumos: [{ tipo: "detonador", cantidad: 50, precio_usd: 4 }] }),
      voladura({ codigo: "V02D626", cantera: "D6", volFecha: "2026-08-10", toneladas: 200, consumos: [{ tipo: "detonador", cantidad: 80, precio_usd: 4 }] }),
    ];
    const serie = serieMensual(voladuras, []);
    expect(serie.map((s) => s.mes)).toEqual(["2026-07", "2026-08"]);
    expect(serie[0].toneladas).toBe(100);
    expect(serie[0].gramosDetonador).toBe(50000); // 50 kg × 1000
    expect(serie[1].toneladas).toBe(200);
  });

  it("sin datos, la serie es vacía", () => {
    expect(serieMensual([], [])).toEqual([]);
  });

  it("con una cantera, acota la serie a esa cantera", () => {
    const voladuras = [
      voladura({ codigo: "V01D626", cantera: "D6", volFecha: "2026-08-10", toneladas: 100 }),
      voladura({ codigo: "V01C326", cantera: "C3", volFecha: "2026-08-10", toneladas: 300 }),
    ];
    const serieD6 = serieMensual(voladuras, [], "D6");
    expect(serieD6).toHaveLength(1);
    expect(serieD6[0].toneladas).toBe(100);
  });
});
