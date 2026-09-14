import { describe, it, expect } from "vitest";
import {
  tarifaVigente,
  montoAcarreo,
  resumenPorFletero,
  totalesPorTipo,
  tipoDeAcarreo,
  esTipoDeAcarreoValido,
  type TarifaAcarreo,
  type AcarreoPlano,
} from "./acarreo";

// Tarifas reales de "Dolomita D1", relevadas de la planilla de balanza.
const TARIFAS_D1: TarifaAcarreo[] = [
  { tipo: "dolomita_d1", desde: "2026-03-01", hasta: "2026-04-30", tarifa: 2103.88 },
  { tipo: "dolomita_d1", desde: "2026-05-01", hasta: "2026-06-30", tarifa: 2190.11 },
  { tipo: "dolomita_d1", desde: "2026-07-01", hasta: null, tarifa: 2266.74 },
];

describe("tipoDeAcarreo / esTipoDeAcarreoValido", () => {
  it("reconoce los 19 tipos relevados y rechaza cualquier otro", () => {
    expect(esTipoDeAcarreoValido("dolomita_d1")).toBe(true);
    expect(esTipoDeAcarreoValido("horas_destape")).toBe(true);
    expect(esTipoDeAcarreoValido("inventado")).toBe(false);
  });

  it("caliza no tiene yacimiento fijo: puede ser de C1 o de C3", () => {
    expect(tipoDeAcarreo("caliza")?.yacimientoCodigo).toBeNull();
    expect(tipoDeAcarreo("dolomita_d1")?.yacimientoCodigo).toBe("D1");
  });
});

describe("tarifaVigente", () => {
  it("elige el período que cubre el mes pedido", () => {
    expect(tarifaVigente(TARIFAS_D1, "dolomita_d1", "2026-03")?.tarifa).toBe(2103.88);
    expect(tarifaVigente(TARIFAS_D1, "dolomita_d1", "2026-06")?.tarifa).toBe(2190.11);
    expect(tarifaVigente(TARIFAS_D1, "dolomita_d1", "2026-08")?.tarifa).toBe(2266.74);
  });

  it("sin vigencia en ese mes, null — no se adivina con la más cercana", () => {
    expect(tarifaVigente(TARIFAS_D1, "dolomita_d1", "2026-01")).toBeNull();
  });

  it("si dos vigencias se solapan, gana la de `desde` más nueva", () => {
    const solapadas: TarifaAcarreo[] = [
      { tipo: "x", desde: "2026-01-01", hasta: "2026-12-31", tarifa: 100 },
      { tipo: "x", desde: "2026-06-01", hasta: null, tarifa: 200 },
    ];
    expect(tarifaVigente(solapadas, "x", "2026-07")?.tarifa).toBe(200);
  });
});

describe("montoAcarreo", () => {
  it("cantidad × tarifa", () => {
    const tarifa = tarifaVigente(TARIFAS_D1, "dolomita_d1", "2026-08")!;
    expect(montoAcarreo(150, tarifa)).toBeCloseTo(150 * 2266.74, 2);
  });

  it("sin tarifa, null — no se inventa un monto en 0", () => {
    expect(montoAcarreo(150, null)).toBeNull();
  });
});

describe("resumenPorFletero", () => {
  it("suma el mes de un fletero, con el monto de cada tipo despejado", () => {
    const acarreos: AcarreoPlano[] = [
      { fleteroId: "f1", tipo: "dolomita_d1", mes: "2026-08-01", cantidad: 100 },
      { fleteroId: "f1", tipo: "horas_destape", mes: "2026-08-01", cantidad: 5 },
      { fleteroId: "f2", tipo: "dolomita_d1", mes: "2026-08-01", cantidad: 999 }, // de otro fletero, no cuenta
    ];
    const tarifas: TarifaAcarreo[] = [
      ...TARIFAS_D1,
      { tipo: "horas_destape", desde: "2026-07-01", hasta: null, tarifa: 27817.75 },
    ];
    const r = resumenPorFletero(acarreos, tarifas, "f1", "2026-08");
    expect(r.porTipo).toHaveLength(2);
    expect(r.totalMonto).toBeCloseTo(100 * 2266.74 + 5 * 27817.75, 2);
    expect(r.sinTarifa).toEqual([]);
  });

  it("un tipo cargado sin tarifa vigente se avisa, no se descarta del total en silencio", () => {
    const acarreos: AcarreoPlano[] = [{ fleteroId: "f1", tipo: "arcilla", mes: "2026-08-01", cantidad: 50 }];
    const r = resumenPorFletero(acarreos, [], "f1", "2026-08");
    expect(r.sinTarifa).toEqual(["arcilla"]);
    expect(r.totalMonto).toBe(0);
  });
});

describe("totalesPorTipo", () => {
  it("suma todos los fleteros juntos, por tipo, del mes pedido", () => {
    const entradas = [
      { tipo: "dolomita_d1", mes: "2026-08-01", cantidad: 100 },
      { tipo: "dolomita_d1", mes: "2026-08-01", cantidad: 50 }, // otro fletero, mismo tipo: se suma
      { tipo: "horas_destape", mes: "2026-08-01", cantidad: 10 },
      { tipo: "dolomita_d1", mes: "2026-07-01", cantidad: 999 }, // otro mes, no cuenta
    ];
    const r = totalesPorTipo(entradas, "2026-08");
    expect(r).toContainEqual({ tipo: "dolomita_d1", etiqueta: "Dolomita D1", unidad: "tonelada", cantidad: 150 });
    expect(r).toContainEqual({ tipo: "horas_destape", etiqueta: "Horas destape", unidad: "hora", cantidad: 10 });
  });

  it("lo que da 0 en el mes no aparece — sólo lo distinto de cero", () => {
    const r = totalesPorTipo([{ tipo: "dolomita_d1", mes: "2026-08-01", cantidad: 0 }], "2026-08");
    expect(r).toEqual([]);
  });

  it("ordena de mayor a menor cantidad", () => {
    const r = totalesPorTipo(
      [
        { tipo: "horas_destape", mes: "2026-08-01", cantidad: 5 },
        { tipo: "dolomita_d1", mes: "2026-08-01", cantidad: 500 },
      ],
      "2026-08"
    );
    expect(r.map((f) => f.tipo)).toEqual(["dolomita_d1", "horas_destape"]);
  });
});

