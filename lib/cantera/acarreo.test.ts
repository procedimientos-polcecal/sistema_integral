import { describe, it, expect } from "vitest";
import {
  tarifaVigente,
  montoAcarreo,
  resumenPorFletero,
  totalesPorTipo,
  resumenAnualPorTipo,
  toneladasPorMaterialYDestino,
  detalleDiarioPorDestino,
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

describe("resumenAnualPorTipo", () => {
  it("junta por tipo, un total por mes del año pedido", () => {
    const entradas = [
      { tipo: "dolomita_d1", mes: "2026-01-01", cantidad: 100 },
      { tipo: "dolomita_d1", mes: "2026-01-01", cantidad: 50 }, // otro fletero, mismo tipo y mes: se suma
      { tipo: "dolomita_d1", mes: "2026-03-01", cantidad: 200 },
      { tipo: "horas_destape", mes: "2026-01-01", cantidad: 10 },
      { tipo: "dolomita_d1", mes: "2025-01-01", cantidad: 999 }, // otro año, no cuenta
    ];
    const r = resumenAnualPorTipo(entradas, "2026");
    const d1 = r.find((f) => f.tipo === "dolomita_d1")!;
    expect(d1.porMes[0]).toBe(150);
    expect(d1.porMes[2]).toBe(200);
    expect(d1.porMes[1]).toBe(0);
    expect(d1.totalAnual).toBe(350);
    expect(d1.etiqueta).toBe("Dolomita D1");
    expect(d1.unidad).toBe("tonelada");
  });

  it("un tipo sin ningún movimiento en el año no aparece", () => {
    const r = resumenAnualPorTipo([{ tipo: "dolomita_d1", mes: "2025-06-01", cantidad: 100 }], "2026");
    expect(r).toEqual([]);
  });

  it("ordena de mayor a menor total anual", () => {
    const r = resumenAnualPorTipo(
      [
        { tipo: "horas_destape", mes: "2026-01-01", cantidad: 5 },
        { tipo: "dolomita_d1", mes: "2026-01-01", cantidad: 500 },
      ],
      "2026"
    );
    expect(r.map((f) => f.tipo)).toEqual(["dolomita_d1", "horas_destape"]);
  });
});

describe("toneladasPorMaterialYDestino", () => {
  it("trae los 19 tipos siempre, aunque no hayan tenido movimiento", () => {
    const r = toneladasPorMaterialYDestino(
      [{ tipo: "dolomita_d1", mes: "2026-08-01", destino: "PT 1", cantidad: 100 }],
      "2026-08"
    );
    expect(r.filas).toHaveLength(19);
    expect(r.filas.find((f) => f.tipo === "arcilla")!.porDestino["PT 1"]).toBe(0);
  });

  it("cruza tipo por destino, sumando lo del mismo par", () => {
    const r = toneladasPorMaterialYDestino(
      [
        { tipo: "dolomita_d1", mes: "2026-08-01", destino: "PT 1", cantidad: 100 },
        { tipo: "dolomita_d1", mes: "2026-08-01", destino: "PT 1", cantidad: 50 },
        { tipo: "dolomita_d1", mes: "2026-08-01", destino: "PT 3", cantidad: 30 },
        { tipo: "chocolata_1", mes: "2026-08-01", destino: "PT 1", cantidad: 10 },
        { tipo: "dolomita_d1", mes: "2026-07-01", destino: "PT 1", cantidad: 999 }, // otro mes, no cuenta
      ],
      "2026-08"
    );
    expect(r.destinos).toEqual(expect.arrayContaining(["PT 1", "PT 3"]));
    const d1 = r.filas.find((f) => f.tipo === "dolomita_d1")!;
    expect(d1.porDestino["PT 1"]).toBe(150);
    expect(d1.porDestino["PT 3"]).toBe(30);
    expect(r.totalesPorDestino["PT 1"]).toBe(160); // 150 de D1 + 10 de chocolata 1
  });

  it("sin destino cargado, se agrupa como tal en vez de perderse", () => {
    const r = toneladasPorMaterialYDestino(
      [{ tipo: "dolomita_d1", mes: "2026-08-01", destino: null, cantidad: 10 }],
      "2026-08"
    );
    expect(r.destinos).toEqual(["(sin destino)"]);
  });

  it("ordena los destinos de mayor a menor total", () => {
    const r = toneladasPorMaterialYDestino(
      [
        { tipo: "dolomita_d1", mes: "2026-08-01", destino: "CHICO", cantidad: 5 },
        { tipo: "dolomita_d1", mes: "2026-08-01", destino: "GRANDE", cantidad: 500 },
      ],
      "2026-08"
    );
    expect(r.destinos).toEqual(["GRANDE", "CHICO"]);
  });
});

describe("detalleDiarioPorDestino", () => {
  it("un renglón por fecha y tipo, cruzado por destino", () => {
    const r = detalleDiarioPorDestino(
      [
        { fecha: "2026-08-01", tipo: "dolomita_d1", destino: "PT 1", cantidad: 675.54 },
        { fecha: "2026-08-05", tipo: "dolomita_d1", destino: "PT 1", cantidad: 693.72 },
        { fecha: "2026-08-04", tipo: "material_desde_pavone", destino: "GALPON 1", cantidad: 105.42 },
      ],
      "2026-08"
    );
    expect(r.filas).toHaveLength(3);
    const dia1 = r.filas.find((f) => f.fecha === "2026-08-01")!;
    expect(dia1.etiqueta).toBe("Dolomita D1");
    expect(dia1.porDestino["PT 1"]).toBeCloseTo(675.54, 2);
    expect(dia1.porDestino["GALPON 1"]).toBe(0);
  });

  it("no trae una fila para un tipo sin movimiento ese día — a diferencia de la matriz mensual", () => {
    const r = detalleDiarioPorDestino(
      [{ fecha: "2026-08-01", tipo: "dolomita_d1", destino: "PT 1", cantidad: 10 }],
      "2026-08"
    );
    expect(r.filas).toHaveLength(1);
  });

  it("ordena por fecha y, dentro del día, por etiqueta", () => {
    const r = detalleDiarioPorDestino(
      [
        { fecha: "2026-08-03", tipo: "dolomita_d1", destino: "PT 1", cantidad: 1 },
        { fecha: "2026-08-01", tipo: "chocolata_1", destino: "PT 1", cantidad: 1 },
        { fecha: "2026-08-01", tipo: "dolomita_d1", destino: "PT 1", cantidad: 1 },
      ],
      "2026-08"
    );
    expect(r.filas.map((f) => `${f.fecha}/${f.tipo}`)).toEqual([
      "2026-08-01/chocolata_1",
      "2026-08-01/dolomita_d1",
      "2026-08-03/dolomita_d1",
    ]);
  });
});

